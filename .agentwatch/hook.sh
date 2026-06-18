#!/bin/bash
# AgentWatch hook - sends event to Unix socket
python3 -c "
import sys, json, os, time, socket
stdin_text = sys.stdin.read().strip()
try:
    data = json.loads(stdin_text) if stdin_text else {}
except:
    data = {}
event = data.get('event') or data.get('hook_event_name') or os.environ.get('CLAUDE_HOOK_EVENT_NAME') or os.environ.get('hook_event_name') or 'unknown'
data['event'] = event
data['ts'] = int(time.time())
# Extract session_id: try hook data fields first (sessionId for Gemini), then env vars, fallback to cwd
if 'session_id' not in data:
    session = data.get('sessionId') or data.get('session') or os.environ.get('CLAUDE_SESSION_ID') or os.environ.get('GEMINI_SESSION_ID') or os.environ.get('CODEX_SESSION_ID')
    if session:
        data['session_id'] = session
# Extract cwd: try hook data first, then env vars (agent-specific), fallback to cwd
if 'cwd' not in data:
    cwd = data.get('cwd') or os.environ.get('CLAUDE_CWD') or os.environ.get('GEMINI_CWD') or os.environ.get('CODEX_CWD')
    data['cwd'] = cwd if cwd else os.getcwd()
for env_key, data_key in (
    ('SUPERSET_PANE_ID', 'superset_pane_id'),
    ('SUPERSET_TAB_ID', 'superset_tab_id'),
    ('SUPERSET_WORKSPACE_ID', 'superset_workspace_id'),
):
    env_val = os.environ.get(env_key)
    if env_val and not data.get(data_key):
        data[data_key] = env_val
# Detect terminal TTY for permission keystroke injection
import subprocess
try:
    tty_result = subprocess.run(['/usr/bin/tty'], capture_output=True, text=True, timeout=2)
    tty_val = tty_result.stdout.strip()
    if tty_val and 'not a tty' not in tty_val:
        data['terminal_tty'] = tty_val
    else:
        ppid = os.getppid()
        ps_result = subprocess.run(['/bin/ps', '-o', 'tty=', '-p', str(ppid)], capture_output=True, text=True, timeout=2)
        ps_tty = ps_result.stdout.strip()
        if ps_tty and ps_tty != '??' and ps_tty != '-':
            data['terminal_tty'] = '/dev/' + ps_tty if not ps_tty.startswith('/dev/') else ps_tty
except:
    pass
try:
    data['terminal_pgrp'] = os.getpgrp()
except:
    pass
for _attempt in range(3):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect('/tmp/agentwatch.sock')
        sock.sendall(json.dumps(data).encode() + b'\n')
        sock.close()
        break
    except:
        sock.close()
        time.sleep(0.1)
"