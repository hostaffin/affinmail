use affinmail_mcp_server::admin::AdminClient;
use affinmail_mcp_server::auth::{AuditLogger, ScopeChecker};
use affinmail_mcp_server::jmap::JmapClient;
use affinmail_mcp_server::prompts;
use affinmail_mcp_server::resources;
use affinmail_mcp_server::tools;
use affinmail_mcp_server::types::{JsonRpcRequest, JsonRpcResponse};
use serde_json::json;
use std::io::{self, BufRead, Write};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = JmapClient::new();
    let admin = AdminClient::new();
    let scopes = ScopeChecker::from_env();
    let audit = AuditLogger::new();

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    eprintln!("[INFO] AffinMail MCP Server started (Stdio JSON-RPC 2.0)");
    eprintln!("[INFO] Connected JMAP Target: {}", client.base_url);
    eprintln!("[INFO] Admin API Target: {}", admin.base_url);

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                let err_res = JsonRpcResponse::error(None, -32700, format!("Parse error: {}", e));
                writeln!(stdout, "{}", serde_json::to_string(&err_res)?)?;
                stdout.flush()?;
                continue;
            }
        };

        let req_id = req.id.clone();
        let response = match req.method.as_str() {
            "initialize" => {
                let init_result = json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {
                            "listChanged": false
                        },
                        "resources": {
                            "subscribe": false,
                            "listChanged": false
                        },
                        "prompts": {
                            "listChanged": false
                        }
                    },
                    "serverInfo": {
                        "name": "affinmail-mcp-server",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                });
                Some(JsonRpcResponse::success(req_id, init_result))
            }
            "notifications/initialized" => {
                // Client handshake ACK notification - no response required in JSON-RPC
                None
            }
            "ping" => Some(JsonRpcResponse::success(req_id, json!({}))),
            "tools/list" => {
                let tool_list = tools::list_tools();
                let result = json!({
                    "tools": tool_list
                });
                Some(JsonRpcResponse::success(req_id, result))
            }
            "tools/call" => {
                let params = req.params.unwrap_or(json!({}));
                let tool_name = params
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let tool_args = params.get("arguments").cloned().unwrap_or(json!({}));

                let call_result =
                    tools::handle_tool_call(tool_name, &tool_args, &client, &admin, &scopes, &audit).await;
                Some(JsonRpcResponse::success(
                    req_id,
                    serde_json::to_value(call_result)?,
                ))
            }
            "resources/list" => {
                let res_list = resources::list_resources();
                let result = json!({
                    "resources": res_list
                });
                Some(JsonRpcResponse::success(req_id, result))
            }
            "resources/read" => {
                let params = req.params.unwrap_or(json!({}));
                let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or_default();

                match resources::handle_read_resource(uri, &client, &scopes).await {
                    Ok(read_result) => {
                        Some(JsonRpcResponse::success(req_id, serde_json::to_value(read_result)?))
                    }
                    Err(err) => Some(JsonRpcResponse::error(req_id, -32603, err)),
                }
            }
            "prompts/list" => {
                let prompt_list = prompts::list_prompts();
                let result = json!({
                    "prompts": prompt_list
                });
                Some(JsonRpcResponse::success(req_id, result))
            }
            "prompts/get" => {
                let params = req.params.unwrap_or(json!({}));
                let prompt_name = params
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let prompt_args = params.get("arguments").cloned().unwrap_or(json!({}));

                match prompts::handle_get_prompt(prompt_name, &prompt_args, &client, &scopes).await {
                    Ok(prompt_result) => Some(JsonRpcResponse::success(
                        req_id,
                        serde_json::to_value(prompt_result)?,
                    )),
                    Err(err) => Some(JsonRpcResponse::error(req_id, -32603, err)),
                }
            }
            unknown_method => Some(JsonRpcResponse::error(
                req_id,
                -32601,
                format!("Method not found: {}", unknown_method),
            )),
        };

        if let Some(res) = response {
            writeln!(stdout, "{}", serde_json::to_string(&res)?)?;
            stdout.flush()?;
        }
    }

    eprintln!("[INFO] AffinMail MCP Server terminated.");
    Ok(())
}
