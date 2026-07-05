// SUPERSEDED — this file is intentionally empty.
//
// The TIFF ingestion module was renamed to `imaging.rs` because naming a module
// `image` shadows the external `image` crate for `use image::…` paths across the
// whole crate (it broke `flatten_png_white` in lib.rs). This file is no longer
// referenced by any `mod` declaration, so it is not compiled. Safe to delete.
