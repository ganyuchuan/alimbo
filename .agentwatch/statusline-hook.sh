#!/bin/bash
# AgentWatch statusLine wrapper - captures rate_limits from Claude Code stdin
# then passes through to the original statusLine command
INPUT=$(cat)
# Save rate_limits to file
echo "$INPUT" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); rl=d.get('rate_limits',{})
    if rl:
        with open('/tmp/agentwatch-rl.json','w') as f: json.dump(rl,f)
except: pass
" 2>/dev/null
# Pass through to original command
ORIG="${AGENTWATCH_STATUSLINE_ORIG:-}"
if [ -n "$ORIG" ]; then
    echo "$INPUT" | $ORIG
fi