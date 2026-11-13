#!/usr/bin/env python3
"""Supabase's API role runs with pg_safeupdate: UPDATE/DELETE without WHERE is rejected
("UPDATE requires a WHERE clause"). Plain local Postgres does not enforce this, so check it statically."""
import re, sys
s = open(sys.argv[1]).read()
bad = []
for m in re.finditer(r'(?is)\b(update\s+public\.\w+\s+set|delete\s+from\s+public\.\w+)(.*?);', s):
    if not re.search(r'(?i)\bwhere\b', m.group(0)):
        bad.append((s[:m.start()].count('\n') + 1, ' '.join(m.group(0).split())[:80]))
for line, stmt in bad:
    print(f'FAIL: schema.sql:{line}: no WHERE clause: {stmt}')
if bad:
    sys.exit(1)
print('ok   - every UPDATE/DELETE has a WHERE clause (Supabase pg_safeupdate)')
