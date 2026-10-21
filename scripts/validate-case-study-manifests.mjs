import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = process.argv.find(x => x.startsWith('--today='))?.slice(8)
  ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
if (!validDate(today)) throw new Error('Use --today=YYYY-MM-DD with a valid date');
const errors = [], warnings = [], slugs = new Set(), refs = new Set();
const allowed = new Set(['content_file', 'title', 'summary', 'meta_description', 'date', 'featured_image', 'featured_image_alt', 'tags', 'draft', 'slug', 'client', 'industry', 'location']);
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e =>
    /^[_.]/.test(e.name) ? [] : e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}
function localFile(s, body = false) {
  if (typeof s !== 'string' || !s || s.includes('\\') || s.includes(':') || s.startsWith('/') || s.split('/').some(p => !p || /^[_.]/.test(p))) throw new Error(`Unsafe repository path: ${s}`);
  if (body && (!s.startsWith('case-studies/') || !/\.(html?|md)$/i.test(s))) throw new Error('content_file must be an HTML or Markdown file in case-studies/');
  const full = path.join(root, s);
  if (!fs.statSync(full).isFile()) throw new Error(`Not a file: ${s}`);
  const real = fs.realpathSync(full);
  if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`Path escapes repository: ${s}`);
  return full;
}
function metadata(full) {
  const text = fs.readFileSync(full, 'utf8');
  if (/\.md$/i.test(full)) {
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return Object.fromEntries((front?.[1] ?? '').split(/\r?\n/).flatMap(line => {
      const m = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
      if (!m) return [];
      const v = m[2].replace(/^(["'])(.*)\1$/, '$2');
      return [[m[1], v === 'true' ? true : v === 'false' ? false : v]];
    }));
  }
  let article = {};
  for (const m of text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const data = JSON.parse(m[1]);
    article = [data, ...(data['@graph'] ?? [])].find(x => x['@type'] === 'Article') ?? article;
  }
  return { title: article.headline ?? text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1], summary: article.description, date: article.datePublished, draft: false };
}
const files = walk('case-studies');
const manifests = files.filter(f => f.endsWith('.manifest.json'));
for (const file of manifests) {
  try {
    const full = path.join(root, file);
    if (fs.statSync(full).size > 16384) throw new Error('Manifest exceeds 16,384 bytes');
    const m = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (!m || Array.isArray(m) || typeof m !== 'object') throw new Error('Manifest must be an object');
    for (const k of Object.keys(m)) if (!allowed.has(k)) throw new Error(`Unknown field: ${k}`);
    const body = localFile(m.content_file, true);
    if (refs.has(m.content_file.toLowerCase())) throw new Error('Duplicate content reference');
    refs.add(m.content_file.toLowerCase());
    const slug = m.slug ?? path.basename(file, '.manifest.json');
    if (typeof slug !== 'string' || !slug.trim() || /[\s/\\?#]/.test(slug) || /^[_.]/.test(slug)) throw new Error('Invalid public slug');
    if (slugs.has(slug.toLowerCase())) throw new Error(`Duplicate slug: ${slug}`);
    slugs.add(slug.toLowerCase());
    for (const k of ['title', 'summary', 'meta_description', 'date', 'slug', 'client', 'industry', 'location', 'featured_image', 'featured_image_alt']) {
      if (k in m && (typeof m[k] !== 'string' || !m[k].trim())) throw new Error(`${k} must be a nonempty string`);
    }
    if ('draft' in m && typeof m.draft !== 'boolean') throw new Error('draft must be a JSON boolean');
    if ('tags' in m && !(Array.isArray(m.tags) ? m.tags.every(t => typeof t === 'string' && t.trim() && !t.includes(',')) : typeof m.tags === 'string' && m.tags.split(',').every(t => t.trim()))) throw new Error('Invalid tags');
    const embedded = metadata(body), effective = { ...embedded, ...m };
    if (m.summary === undefined && m.meta_description !== undefined) effective.summary = m.meta_description;
    effective.summary ??= effective.meta_description;
    if (typeof effective.title !== 'string' || !effective.title.trim() || [...effective.title].length > 140) throw new Error('Missing or invalid effective title');
    if (typeof effective.summary !== 'string' || [...effective.summary].length < 30 || [...effective.summary].length > 180) throw new Error('Missing or invalid effective summary (30–180 characters)');
    if (effective.date === undefined) warnings.push(`${file}: missing approved date; owner input required`);
    else if (!validDate(effective.date)) throw new Error('Invalid date');
    else if (effective.date > today) warnings.push(`${file}: future date; excluded by website`);
    if (typeof effective.draft !== 'boolean') throw new Error('Missing effective publication status');
    if (/\.md$/i.test(body) && (!effective.client || !effective.industry)) throw new Error('Markdown requires client and industry');
    if (m.featured_image) {
      if (!m.featured_image_alt?.trim()) throw new Error('featured_image_alt required');
      if (/^https:\/\//i.test(m.featured_image)) {
        const url = new URL(m.featured_image);
        if (!url.hostname || url.username || url.password) throw new Error('Invalid HTTPS image URL');
        warnings.push(`${file}: manually verify HTTPS image availability and approval`);
      } else localFile(m.featured_image);
    } else warnings.push(`${file}: no manifest image; confirm inherited image or request approved asset`);
    console.log(`PASS ${file} -> ${m.content_file} (${fs.statSync(full).size} manifest bytes; ${fs.statSync(body).size} body bytes)`);
  } catch (e) { errors.push(`${file}: ${e.message}`); }
}
const bodies = files.filter(f => /\.(html?|md)$/i.test(f));
for (const file of bodies) {
  const limit = /\.md$/i.test(file) ? 256000 : 5242880;
  if (fs.statSync(path.join(root, file)).size > limit) errors.push(`${file}: body exceeds ${limit} bytes`);
  if (!refs.has(file.toLowerCase())) {
    const slug = path.basename(file).replace(/\.(html?|md)$/i, '');
    if (slugs.has(slug.toLowerCase())) errors.push(`${file}: duplicate standalone slug`);
    slugs.add(slug.toLowerCase());
    warnings.push(`${file}: standalone article lacks manifest`);
  }
}
const count = manifests.length + bodies.filter(f => !refs.has(f.toLowerCase())).length;
if (count > 50) errors.push(`${count} posts exceeds 50`);
// Excluded template must still be valid JSON with only accepted fields.
try {
  const template = fs.readFileSync(path.join(root, 'case-studies/_template.manifest.json'));
  const m = JSON.parse(template.toString('utf8'));
  if (template.length > 16384 || !m.content_file || Object.keys(m).some(k => !allowed.has(k))) throw new Error('Invalid template');
} catch (e) { errors.push(`Template: ${e.message}`); }
warnings.forEach(w => console.warn(`WARN ${w}`));
errors.forEach(e => console.error(`ERROR ${e}`));
console.log(`${count} post(s), ${manifests.length} manifest(s), ${errors.length} error(s), ${warnings.length} warning(s). As of ${today}.`);
process.exitCode = errors.length ? 1 : 0;
