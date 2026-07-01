//! PubMed module — search the NCBI E-utilities API.
//!
//! Provides search and summary capabilities for PubMed articles.
//! All HTTP calls are made from Rust to avoid CORS issues in the frontend.

use serde::{Deserialize, Serialize};

const ESEARCH_URL: &str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY_URL: &str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PubMedArticle {
    pub pmid: String,
    pub title: String,
    pub authors: Vec<String>,
    pub journal: String,
    pub year: String,
    pub doi: Option<String>,
}

pub struct PubMedClient {
    base_esearch: String,
    base_esummary: String,
}

impl PubMedClient {
    pub fn new() -> Self {
        Self {
            base_esearch: ESEARCH_URL.to_string(),
            base_esummary: ESUMMARY_URL.to_string(),
        }
    }

    /// Search PubMed for PMIDs matching the query.
    pub async fn search(&self, query: &str, max_results: u32) -> Result<Vec<String>, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get(&self.base_esearch)
            .query(&[
                ("db", "pubmed"),
                ("term", query),
                ("retmax", &max_results.to_string()),
                ("retmode", "json"),
            ])
            .send()
            .await
            .map_err(|e| format!("PubMed search request failed: {}", e))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("PubMed search response parse failed: {}", e))?;

        let ids = body["esearchresult"]["idlist"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(ids)
    }

    /// Get article summaries for a list of PMIDs.
    pub async fn get_summaries(&self, pmids: &[String]) -> Result<Vec<PubMedArticle>, String> {
        if pmids.is_empty() {
            return Ok(vec![]);
        }

        let client = reqwest::Client::new();
        let id_list = pmids.join(",");
        let resp = client
            .get(&self.base_esummary)
            .query(&[
                ("db", "pubmed"),
                ("id", &id_list),
                ("retmode", "json"),
            ])
            .send()
            .await
            .map_err(|e| format!("PubMed summary request failed: {}", e))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("PubMed summary response parse failed: {}", e))?;

        let result_obj = body
            .get("result")
            .ok_or_else(|| "No 'result' field in esummary response".to_string())?;

        let mut articles = Vec::new();
        for pmid in pmids {
            if let Some(article_data) = result_obj.get(pmid) {
                let title = article_data["title"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();

                let authors = article_data["authors"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|a| a["name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();

                let journal = article_data["fulljournalname"]
                    .as_str()
                    .or_else(|| article_data["source"].as_str())
                    .unwrap_or("")
                    .to_string();

                let year = article_data["pubdate"]
                    .as_str()
                    .unwrap_or("")
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_string();

                let doi = article_data["elocationid"]
                    .as_str()
                    .and_then(|s| {
                        if s.starts_with("doi:") {
                            Some(s.trim_start_matches("doi:").trim().to_string())
                        } else {
                            None
                        }
                    })
                    .or_else(|| {
                        article_data["articleids"]
                            .as_array()
                            .and_then(|ids| {
                                ids.iter()
                                    .find(|id| id["idtype"].as_str() == Some("doi"))
                                    .and_then(|id| id["value"].as_str().map(String::from))
                            })
                    });

                articles.push(PubMedArticle {
                    pmid: pmid.clone(),
                    title,
                    authors,
                    journal,
                    year,
                    doi,
                });
            }
        }

        Ok(articles)
    }
}
