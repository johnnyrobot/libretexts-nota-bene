const fs = require('node:fs');
const path = require('node:path');

function canonical(value) {
  const absolute = path.resolve(value);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  return path.join(canonical(path.dirname(absolute)), path.basename(absolute));
}

function overlaps(a, b) {
  const ab = path.relative(a, b);
  const ba = path.relative(b, a);
  const contained = relative => relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  return contained(ab) || contained(ba);
}

function assertStateOutsideCheckouts(state, client) {
  if (!state || !client || !path.isAbsolute(state) || !path.isAbsolute(client)
    || [path.resolve(__dirname, '..'), client].some(root => overlaps(canonical(root), canonical(state)))) {
    const error = new Error('Use protected state outside both checkouts; canonical paths must not overlap.');
    error.code = 'NB_BASELINE_STATE_PATH';
    throw error;
  }
}

module.exports = { canonical, overlaps, assertStateOutsideCheckouts };
