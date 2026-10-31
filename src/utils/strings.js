// Removes trailing "/" characters in one pass. A regex such as /\/+$/ is quadratic on long
// runs of slashes, and some of these strings come from users or the model.
function trimTrailingSlashes(value) {
  const text = String(value);
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
}

module.exports = { trimTrailingSlashes };
