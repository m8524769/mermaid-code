; NSIS installer hooks for Mermaid Code.
;
; The MCP server runs as an independent sidecar process (mermaid-code-mcp.exe,
; spawned via std::process::Command in src/mcp.rs). NSIS's default "close the
; running app" step only targets the main executable, and during an auto-update
; the app hard-exits through the updater's std::process::exit(0) — so its own
; RunEvent::Exit -> child.kill() never runs and the sidecar is left orphaned.
; A still-running sidecar holds an exclusive lock on its own .exe, which makes
; the installer fail with "Error opening file for writing: ...mermaid-code-mcp.exe"
; (and would likewise block the uninstaller from removing it).

; Force-kill any running MCP sidecar and give the OS a moment to release the file
; handle before we touch files. $0 is saved/restored so the hook can't disturb the
; surrounding tauri-generated installer script. taskkill ships with Windows;
; nsExec::Exec runs it hidden and we ignore the result (the process may already be
; gone). /T also takes down any child processes it spawned.
!macro KILL_MCP_SIDECAR
  Push $0
  nsExec::Exec 'taskkill /F /IM mermaid-code-mcp.exe /T'
  Pop $0    ; discard nsExec result
  Pop $0    ; restore $0
  Sleep 500
!macroend

; Runs before copying files, setting registry keys and creating shortcuts.
!macro NSIS_HOOK_PREINSTALL
  !insertmacro KILL_MCP_SIDECAR
!macroend

; Runs before removing any files, registry keys and shortcuts.
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KILL_MCP_SIDECAR
!macroend
