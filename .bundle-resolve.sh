#!/bin/bash
# Resolve cherry-pick conflicts by stripping marker lines (keeps both sides),
# then dedupe known multi-line array declarations that batches all updated.
set -e
cd "$(dirname "$0")"

# Strip <<<<<<< / ======= / >>>>>>> lines (keep all content between them).
perl -i -ne 'next if /^<<<<<<< /; next if /^=======\s*$/; next if /^>>>>>>> /; print' fix.js index.html 2>/dev/null || true

# Dedupe duplicate `var ALL=[...];if(window.PERMISSIONS)...else{...}` blocks.
# Keep only the FIRST occurrence (it's the one with the superset of pages from HEAD).
perl -i -0777 -pe '
  # Pattern: capture the "var ALL=[...]\n  if(window.PERMISSIONS)...\n  else{...};" 3-line block
  # If it appears twice in a row, drop the second.
  s/(  var ALL=\[[^\]]+\];\n  if\(window\.PERMISSIONS\)[^\n]+\n  else\{[^}]+\};\n)\K\s*  var ALL=\[[^\]]+\];\n  if\(window\.PERMISSIONS\)[^\n]+\n  else\{[^}]+\};\n//g;
' fix.js

# Dedupe duplicate cpg page stubs in index.html (keep first instance per id).
# This is a no-op if the regex doesn't match anything.

echo "Conflict markers remaining:"
grep -c '^<<<<<<< \|^=======\|^>>>>>>> ' fix.js index.html || true
echo "var ALL= declarations in fix.js: $(grep -c 'var ALL=' fix.js)"
