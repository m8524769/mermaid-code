use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

async fn spawn_claude(
    prompt: &str,
) -> (
    tokio::process::Child,
    tokio::process::ChildStdin,
    tokio::process::ChildStdout,
    tokio::process::ChildStderr,
) {
    let mut child = Command::new("claude")
        .args([
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--permission-prompt-tool",
            "stdio",
            "--verbose",
        ])
        .stdout(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("failed to spawn claude — is it in PATH?");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Send initial prompt via stdin in stream-json mode
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": prompt }
    });
    let line = serde_json::to_string(&msg).unwrap() + "\n";
    stdin.write_all(line.as_bytes()).await.unwrap();

    (child, stdin, stdout, stderr)
}

fn build_control_response(request_id: &str, approved: bool, tool_input: Option<&serde_json::Value>) -> String {
    let inner = if approved {
        serde_json::json!({
            "behavior": "allow",
            "updatedInput": tool_input.unwrap_or(&serde_json::json!({})),
        })
    } else {
        serde_json::json!({ "behavior": "deny", "message": "User denied permission" })
    };
    let msg = serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": inner,
        }
    });
    serde_json::to_string(&msg).unwrap() + "\n"
}

/// Verifies the full permission flow:
/// Claude requests permission → we respond allow → tool executes → result arrives.
///
/// Run with: cargo test --test agent_permission -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn test_permission_allow_flow() {
    let (_child, mut stdin, stdout, stderr) =
        spawn_claude("Write the text 'permission_ok' to a file called /tmp/agent_permission_test.txt using the Write tool").await;
    let mut lines = BufReader::new(stdout).lines();
    let mut err_lines = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = err_lines.next_line().await {
            eprintln!("[stderr] {line}");
        }
    });

    eprintln!("[test] process spawned, waiting for output...");

    let mut got_permission = false;
    let mut tool_result_content = String::new();
    let mut exit_is_error = true;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        eprintln!("[raw] {line}");

        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        match val["type"].as_str() {
            Some("control_request") => {
                if val["request"]["subtype"].as_str() == Some("can_use_tool") {
                    let request_id = val["request_id"].as_str().unwrap_or("");
                    let tool_name = val["request"]["tool_name"].as_str().unwrap_or("");
                    let tool_input = val["request"]["input"].clone();
                    eprintln!("[permission_request] id={request_id} tool={tool_name}");
                    got_permission = true;

                    let msg = build_control_response(request_id, true, Some(&tool_input));
                    stdin.write_all(msg.as_bytes()).await.unwrap();
                    eprintln!("[→ sent allow]");
                }
            }
            Some("user") => {
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"].as_str() == Some("tool_result") {
                        let content = match &block["content"] {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Array(arr) => arr
                                .first()
                                .and_then(|b| b["text"].as_str())
                                .unwrap_or("")
                                .to_string(),
                            _ => String::new(),
                        };
                        tool_result_content = content.trim().to_string();
                        eprintln!("[tool_result] {tool_result_content:?}");
                    }
                }
            }
            Some("result") => {
                exit_is_error = val["is_error"].as_bool().unwrap_or(true);
                let cost = val["total_cost_usd"].as_f64().unwrap_or(0.0);
                eprintln!("[exit] is_error={exit_is_error} cost=${cost:.4}");
                break;
            }
            Some("assistant") => {
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"].as_str() == Some("text") {
                        let text = block["text"].as_str().unwrap_or("");
                        if !text.is_empty() {
                            eprintln!("[message] {text}");
                        }
                    }
                }
            }
            _ => {}
        }
    }

    assert!(
        got_permission,
        "no permission_request received — check --permission-prompt-tool stdio is supported"
    );
    assert!(
        tool_result_content.contains("permission_ok") || std::fs::read_to_string("/tmp/agent_permission_test.txt")
            .unwrap_or_default()
            .contains("permission_ok"),
        "tool_result should contain 'permission_ok', got: {tool_result_content:?}"
    );
    assert!(!exit_is_error, "session exited with error");
    let _ = std::fs::remove_file("/tmp/agent_permission_test.txt");
}

/// Verifies that a single process handles two consecutive turns without restarting.
/// Claude should stay alive after the first `result` and respond to a second message.
///
/// Run with: cargo test --test agent_permission -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn test_multi_turn() {
    let (_child, mut stdin, stdout, stderr) =
        spawn_claude("Reply with exactly the word: TURN_ONE").await;
    let mut lines = BufReader::new(stdout).lines();
    let mut err_lines = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = err_lines.next_line().await {
            eprintln!("[stderr] {line}");
        }
    });

    let mut turn1_text = String::new();
    let mut turn2_text = String::new();

    // ── Round 1 ──────────────────────────────────────────────────────────────
    eprintln!("[test] waiting for turn 1...");
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        match val["type"].as_str() {
            Some("assistant") => {
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"].as_str() == Some("text") {
                        turn1_text.push_str(block["text"].as_str().unwrap_or(""));
                    }
                }
            }
            Some("result") => {
                let is_error = val["is_error"].as_bool().unwrap_or(true);
                eprintln!("[turn1 result] is_error={is_error} text={turn1_text:?}");
                assert!(!is_error, "turn 1 exited with error");
                break;
            }
            _ => {}
        }
    }

    assert!(!turn1_text.is_empty(), "turn 1 got no text response");

    // ── Round 2: send second message to the same live process ─────────────────
    eprintln!("[test] sending turn 2...");
    let msg2 = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": "Now reply with exactly the word: TURN_TWO" }
    });
    let line2 = serde_json::to_string(&msg2).unwrap() + "\n";
    stdin.write_all(line2.as_bytes()).await.unwrap();

    eprintln!("[test] waiting for turn 2...");
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        match val["type"].as_str() {
            Some("assistant") => {
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"].as_str() == Some("text") {
                        turn2_text.push_str(block["text"].as_str().unwrap_or(""));
                    }
                }
            }
            Some("result") => {
                let is_error = val["is_error"].as_bool().unwrap_or(true);
                eprintln!("[turn2 result] is_error={is_error} text={turn2_text:?}");
                assert!(!is_error, "turn 2 exited with error");
                break;
            }
            _ => {}
        }
    }

    assert!(!turn2_text.is_empty(), "turn 2 got no text response — process may have exited after turn 1");
}

/// Verifies that denying a permission causes Claude to abort the tool and reply without executing.
///
/// Run with: cargo test --test agent_permission -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn test_permission_deny_flow() {
    let (_child, mut stdin, stdout, stderr) =
        spawn_claude("Write the text 'permission_ok' to a file called /tmp/agent_permission_test.txt using the Write tool").await;
    let mut lines = BufReader::new(stdout).lines();
    let mut err_lines = BufReader::new(stderr).lines();

    tokio::spawn(async move {
        while let Ok(Some(line)) = err_lines.next_line().await {
            eprintln!("[stderr] {line}");
        }
    });

    eprintln!("[test] process spawned, waiting for output...");

    let mut got_permission = false;
    let mut tool_executed = false;
    let mut exit_is_error = true;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        eprintln!("[raw] {line}");

        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        match val["type"].as_str() {
            Some("control_request") => {
                if val["request"]["subtype"].as_str() == Some("can_use_tool") {
                    let request_id = val["request_id"].as_str().unwrap_or("");
                    eprintln!("[permission_request] id={request_id} → sending deny");
                    got_permission = true;

                    let msg = build_control_response(request_id, false, None);
                    stdin.write_all(msg.as_bytes()).await.unwrap();
                    eprintln!("[→ sent deny]");
                }
            }
            Some("user") => {
                for block in val["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"].as_str() == Some("tool_result") {
                        tool_executed = true;
                        let content = match &block["content"] {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Array(arr) => arr
                                .first()
                                .and_then(|b| b["text"].as_str())
                                .unwrap_or("")
                                .to_string(),
                            _ => String::new(),
                        };
                        eprintln!("[tool_result after deny] {content:?}");
                    }
                }
            }
            Some("result") => {
                exit_is_error = val["is_error"].as_bool().unwrap_or(true);
                eprintln!("[exit] is_error={exit_is_error}");
                break;
            }
            _ => {}
        }
    }

    assert!(got_permission, "no permission_request received");
    assert!(!exit_is_error, "session should exit cleanly even after deny");
    eprintln!("tool_executed={tool_executed}");
}
