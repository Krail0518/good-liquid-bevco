// Publish the complete Edge Function document as CSP-compatible static HTML.
// Supabase's public gateway serves text/html as text/plain, so customers use this copy.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/terms-and-conditions/index.ts'), 'utf8');
const literal = source.match(/const page = ("[^\n]*");/);
if (!literal) throw new Error('Terms page literal missing');
const page = JSON.parse(literal[1]);
const style = page.match(/<style>([\s\S]*?)<\/style>/);
if (!style) throw new Error('Terms stylesheet missing');
fs.writeFileSync(path.join(root, 'terms-and-conditions.css'), style[1].trim() + '\n');
fs.writeFileSync(path.join(root, 'terms-and-conditions.html'), page.replace(style[0], '<link rel="stylesheet" href="/terms-and-conditions.css">'));
