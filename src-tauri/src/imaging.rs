// ---------------------------------------------------------------------------
// imaging.rs — robust scientific-TIFF ingestion (Stage 1 of the image-analysis
// workflow; see IMAGE_ANALYSIS_PLAN.md).
//
// NOTE ON THE MODULE NAME: this module is `imaging`, NOT `image`. Naming it
// `image` shadows the external `image` crate for `use image::…` paths across the
// whole crate (it broke `flatten_png_white` in lib.rs). Keep it `imaging` so
// both this module and lib.rs can reach the real `image` crate.
//
// WHY THIS EXISTS
// The old path decoded TIFFs in the browser via UTIF (`GelWorkspace.loadTiff`),
// which clips/mis-scales 16-bit samples and chokes on BigTIFF and several
// compression variants — the source of the "TIFF import is buggy" pain. Here we
// decode in Rust with the `tiff` crate, which preserves the full 16-bit range,
// and hand the frontend a *downsampled, contrast-stretched preview* plus enough
// stats to drive live window/level sliders.
//
// CORRECTNESS RULE (faint GFP): the preview is for *viewing and segmentation
// only*. It is contrast-stretched, which is lossy. Quantitative measurement must
// run on the raw 16-bit pixels (a later `measure_tiff` command reads full-res
// from disk); nothing here should ever be summed for a reported number.
//
// Commands:
//   list_tiffs(dir)                              -> Vec<TiffMeta>
//   decode_tiff(path, max_dim, page, low, high)  -> DecodedTiff (base64 PNG preview)
// ---------------------------------------------------------------------------

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use tiff::decoder::{Decoder, DecodingResult};
use tiff::ColorType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TiffMeta {
    pub path: String,
    pub name: String,
    /// First-page width / height in pixels.
    pub width: u32,
    pub height: u32,
    /// Bits per sample of the first page (8, 16, 32, ...).
    pub bits_per_sample: u16,
    /// Samples per pixel (1 = grayscale, 3 = RGB, ...).
    pub samples: u16,
    /// Number of pages / channels stored in the file.
    pub pages: u32,
    /// Set when the header could not be read; the other fields are best-effort.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodedTiff {
    /// Native (full-resolution) dimensions of the decoded page.
    pub nat_w: u32,
    pub nat_h: u32,
    /// Preview dimensions after downsampling to fit `max_dim`.
    pub preview_w: u32,
    pub preview_h: u32,
    /// preview_w / nat_w (== preview_h / nat_h); multiply preview coords by
    /// 1/scale to map back to native pixels for measurement.
    pub scale: f64,
    pub pages: u32,
    pub bits_per_sample: u16,
    pub samples: u16,
    /// Raw min/max intensity across the (downsampled) grid — the true dynamic
    /// range, before any display stretch.
    pub raw_min: f64,
    pub raw_max: f64,
    /// The intensity window actually mapped to [0,255] for this preview. When
    /// the caller passes explicit low/high these echo them; otherwise they are
    /// the auto percentile bounds so the UI can seed its sliders.
    pub applied_low: f64,
    pub applied_high: f64,
    /// Grayscale 8-bit preview PNG as a `data:image/png;base64,...` URL.
    pub preview_png_base64: String,
}

const TIFF_EXTS: [&str; 4] = ["tif", "tiff", "TIF", "TIFF"];

fn is_tiff(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| TIFF_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

/// Samples-per-pixel and bit-depth for a TIFF color type. `tiff` reports bit
/// depth as `u8`; we widen to `u16` for the frontend.
fn color_info(ct: ColorType) -> (u16 /*samples*/, u16 /*bits*/) {
    match ct {
        ColorType::Gray(b) => (1, b as u16),
        ColorType::GrayA(b) => (2, b as u16),
        ColorType::RGB(b) => (3, b as u16),
        ColorType::RGBA(b) => (4, b as u16),
        ColorType::CMYK(b) => (4, b as u16),
        ColorType::YCbCr(b) => (3, b as u16),
        // Palette / other: reduce to a single 8-bit sample so we still preview.
        _ => (1, 8),
    }
}

/// Count pages by walking IFDs. Cheap: advances headers, does not decode pixels.
fn count_pages(path: &Path) -> u32 {
    let Ok(file) = File::open(path) else { return 0 };
    let Ok(mut dec) = Decoder::new(BufReader::new(file)) else { return 0 };
    let mut n: u32 = 1;
    while dec.more_images() {
        if dec.next_image().is_err() {
            break;
        }
        n += 1;
    }
    n
}

/// Convert a decoded page into a single-channel f32 intensity grid.
/// Multi-sample pages are reduced to luminance (RGB) or the first sample.
fn to_luma_f32(res: DecodingResult, samples: u16) -> Vec<f32> {
    // Normalise every numeric variant into a flat f32 sample vector first.
    let flat: Vec<f32> = match res {
        DecodingResult::U8(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::U16(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::U32(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::U64(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::I8(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::I16(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::I32(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::I64(v) => v.into_iter().map(|x| x as f32).collect(),
        DecodingResult::F32(v) => v,
        DecodingResult::F64(v) => v.into_iter().map(|x| x as f32).collect(),
    };
    let s = samples.max(1) as usize;
    if s == 1 {
        return flat;
    }
    let px = flat.len() / s;
    let mut out = Vec::with_capacity(px);
    for i in 0..px {
        let base = i * s;
        if s >= 3 {
            let r = flat[base];
            let g = flat[base + 1];
            let b = flat[base + 2];
            out.push(0.299 * r + 0.587 * g + 0.114 * b);
        } else {
            out.push(flat[base]); // GrayA etc. -> first sample
        }
    }
    out
}

/// Average-pool a full-res luma grid down to fit within `max_dim`.
/// Returns (small grid, out_w, out_h, scale).
fn downsample(luma: &[f32], w: u32, h: u32, max_dim: u32) -> (Vec<f32>, u32, u32, f64) {
    let max_dim = max_dim.max(1);
    let scale = (max_dim as f64 / w.max(h) as f64).min(1.0);
    let ow = ((w as f64 * scale).round() as u32).max(1);
    let oh = ((h as f64 * scale).round() as u32).max(1);
    if ow == w && oh == h {
        return (luma.to_vec(), w, h, 1.0);
    }
    let mut out = vec![0f32; (ow * oh) as usize];
    // Box-average: each output pixel is the mean of its source block. Averaging
    // (not nearest) keeps faint signal from being dropped between samples.
    for oy in 0..oh {
        let y0 = (oy as u64 * h as u64 / oh as u64) as u32;
        let y1 = (((oy + 1) as u64 * h as u64 / oh as u64) as u32).max(y0 + 1).min(h);
        for ox in 0..ow {
            let x0 = (ox as u64 * w as u64 / ow as u64) as u32;
            let x1 = (((ox + 1) as u64 * w as u64 / ow as u64) as u32).max(x0 + 1).min(w);
            let mut sum = 0f64;
            let mut cnt = 0u64;
            for yy in y0..y1 {
                let row = (yy * w) as usize;
                for xx in x0..x1 {
                    sum += luma[row + xx as usize] as f64;
                    cnt += 1;
                }
            }
            out[(oy * ow + ox) as usize] = if cnt > 0 { (sum / cnt as f64) as f32 } else { 0.0 };
        }
    }
    (out, ow, oh, scale)
}

/// Percentile of a copy-sorted grid. `p` in [0,1].
fn percentile(sorted: &[f32], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((p * (sorted.len() - 1) as f64).round() as usize).min(sorted.len() - 1);
    sorted[idx] as f64
}

fn decode_page(path: &Path, page: u32) -> Result<(Vec<f32>, u32, u32, u16, u16), String> {
    let file = File::open(path).map_err(|e| format!("open {}: {}", path.display(), e))?;
    let mut dec = Decoder::new(BufReader::new(file)).map_err(|e| format!("tiff header: {}", e))?;
    for _ in 0..page {
        if !dec.more_images() {
            return Err(format!("page {} out of range", page));
        }
        dec.next_image().map_err(|e| format!("seek page {}: {}", page, e))?;
    }
    let (w, h) = dec.dimensions().map_err(|e| format!("dimensions: {}", e))?;
    let ct = dec.colortype().map_err(|e| format!("colortype: {}", e))?;
    let (samples, bits) = color_info(ct);
    let res = dec.read_image().map_err(|e| format!("read pixels: {}", e))?;
    let luma = to_luma_f32(res, samples);
    if luma.len() < (w as usize * h as usize) {
        return Err("decoded fewer pixels than dimensions imply".into());
    }
    Ok((luma, w, h, samples, bits))
}

/// Scan a directory (non-recursive) for TIFF files and report header metadata.
#[tauri::command]
pub fn list_tiffs(dir: String) -> Result<Vec<TiffMeta>, String> {
    let dpath = PathBuf::from(&dir);
    let entries =
        std::fs::read_dir(&dpath).map_err(|e| format!("read dir {}: {}", dir, e))?;
    let mut out: Vec<TiffMeta> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() || !is_tiff(&p) {
            continue;
        }
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let path_str = p.to_string_lossy().to_string();
        // Read just the first-page header for dims/type.
        let meta = (|| -> Result<TiffMeta, String> {
            let file = File::open(&p).map_err(|e| e.to_string())?;
            let mut dec = Decoder::new(BufReader::new(file)).map_err(|e| e.to_string())?;
            let (w, h) = dec.dimensions().map_err(|e| e.to_string())?;
            let (samples, bits) = color_info(dec.colortype().map_err(|e| e.to_string())?);
            Ok(TiffMeta {
                path: path_str.clone(),
                name: name.clone(),
                width: w,
                height: h,
                bits_per_sample: bits,
                samples,
                pages: count_pages(&p),
                error: None,
            })
        })();
        out.push(meta.unwrap_or_else(|e| TiffMeta {
            path: path_str,
            name,
            width: 0,
            height: 0,
            bits_per_sample: 0,
            samples: 0,
            pages: 0,
            error: Some(e),
        }));
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Decode one page of a TIFF into a downsampled, contrast-stretched grayscale
/// preview (base64 PNG) plus the stats needed to drive window/level sliders.
///
/// `low`/`high` are optional raw-intensity window bounds; when omitted the
/// window is auto-set to the 0.5 / 99.5 percentiles so faint GFP is visible.
#[tauri::command]
pub fn decode_tiff(
    path: String,
    max_dim: Option<u32>,
    page: Option<u32>,
    low: Option<f64>,
    high: Option<f64>,
) -> Result<DecodedTiff, String> {
    let p = PathBuf::from(&path);
    let page = page.unwrap_or(0);
    let max_dim = max_dim.unwrap_or(1024);

    let (luma, w, h, samples, bits) = decode_page(&p, page)?;
    let (small, ow, oh, scale) = downsample(&luma, w, h, max_dim);

    // Stats + auto window from the downsampled grid (cheap, representative).
    let mut sorted = small.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let raw_min = sorted.first().copied().unwrap_or(0.0) as f64;
    let raw_max = sorted.last().copied().unwrap_or(0.0) as f64;
    let auto_low = percentile(&sorted, 0.005);
    let auto_high = percentile(&sorted, 0.995);
    let mut lo = low.unwrap_or(auto_low);
    let mut hi = high.unwrap_or(auto_high);
    if hi <= lo {
        // Degenerate window (flat image / bad bounds): fall back to full range.
        lo = raw_min;
        hi = if raw_max > raw_min { raw_max } else { raw_min + 1.0 };
    }
    let span = (hi - lo).max(1e-9);

    // Map the raw window to 8-bit and encode as grayscale PNG.
    let mut gray = vec![0u8; (ow * oh) as usize];
    for (i, &v) in small.iter().enumerate() {
        let t = ((v as f64 - lo) / span).clamp(0.0, 1.0);
        gray[i] = (t * 255.0).round() as u8;
    }
    let img: image::GrayImage = image::ImageBuffer::from_raw(ow, oh, gray)
        .ok_or_else(|| "preview buffer size mismatch".to_string())?;
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("encode preview PNG: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());

    Ok(DecodedTiff {
        nat_w: w,
        nat_h: h,
        preview_w: ow,
        preview_h: oh,
        scale,
        pages: count_pages(&p),
        bits_per_sample: bits,
        samples,
        raw_min,
        raw_max,
        applied_low: lo,
        applied_high: hi,
        preview_png_base64: format!("data:image/png;base64,{}", b64),
    })
}
