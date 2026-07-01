//! AI module — optional local LLM integration via Ollama.
//!
//! Provides a trait-based abstraction for AI completions. The default
//! OllamaProvider connects to a local Ollama instance. AI features are
//! optional — the app works fully without an LLM connected.

/// Trait for AI completion providers.
pub trait AiProvider: Send + Sync {
    fn complete(&self, prompt: &str) -> Result<String, String>;
}

/// Ollama-based AI provider for local LLM inference.
pub struct OllamaProvider {
    pub base_url: String,
    pub model: String,
}

impl OllamaProvider {
    pub fn new() -> Self {
        OllamaProvider {
            base_url: "http://localhost:11434".to_string(),
            model: "llama3".to_string(),
        }
    }
}

// NOT implemented yet — will be wired in v1.1
// impl AiProvider for OllamaProvider { ... }
