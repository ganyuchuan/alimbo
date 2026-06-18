#!/bin/bash
# AgentWatch Gemini BeforeTool permission hook - blocking
INPUT=$(cat)
SCRIPT=$(cat << 'PYEOF'
import sys, json, os, time, socket

LOG = '/tmp/agentwatch-permhook.log'
def log(msg):
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} [gemini] {msg}\n')

log('=== Gemini BeforeTool permission hook started ===')

stdin_text = os.environ.get('HOOK_INPUT', '').strip()
log(f'stdin: {stdin_text[:200]}')
try:
    data = json.loads(stdin_text) if stdin_text else {}
except:
    data = {}

data['event'] = 'PermissionRequest'
data['agent_type'] = 'Gemini'
data['ts'] = int(time.time())

if 'session_id' not in data:
    session = data.get('sessionId') or os.environ.get('GEMINI_SESSION_ID') or ''
    if session:
        data['session_id'] = session

if 'cwd' not in data:
    data['cwd'] = data.get('cwd') or os.environ.get('GEMINI_CWD') or os.getcwd()

for env_key, data_key in (
    ('SUPERSET_PANE_ID', 'superset_pane_id'),
    ('SUPERSET_TAB_ID', 'superset_tab_id'),
    ('SUPERSET_WORKSPACE_ID', 'superset_workspace_id'),
):
    env_val = os.environ.get(env_key)
    if env_val and not data.get(data_key):
        data[data_key] = env_val

session_id = data.get('session_id', '')
sid8 = session_id[:8] if len(session_id) >= 8 else session_id

# Detect terminal TTY for input injection
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
            data['terminal_tty'] = f'/dev/{ps_tty}' if not ps_tty.startswith('/dev/') else ps_tty
except:
    pass
log(f'sid={session_id} sid8={sid8} tty={data.get("terminal_tty", "none")}')

for _attempt in range(3):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect('/tmp/agentwatch.sock')
        sock.sendall(json.dumps(data).encode() + b'\n')
        sock.close()
        log('socket OK')
        break
    except Exception as e:
        sock.close()
        log(f'socket attempt {_attempt+1} FAIL {e}')
        time.sleep(0.1)

# Gemini BeforeTool: non-blocking. Allow by default.
# Deny decisions are handled by terminal input injection from AgentWatch UI.
log('exiting (non-blocking, allow by default)')
PYEOF
)
HOOK_INPUT="$INPUT" python3 -c "$SCRIPT"