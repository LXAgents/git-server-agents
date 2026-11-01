// What an answer cost, summed over its model calls.

// A new tally for one answer.
function newSpend() {
  return { cost: 0, complete: true };
}

// Adds one call's cost to the answer's total. A call without a reported cost makes the total
// a lower bound, shown with "≥".
function addCost(spend, cost) {
  if (typeof cost === 'number') spend.cost += cost;
  else spend.complete = false;
}

// "0.000120" -> "0.00012", "1.000000" -> "1". Done by hand to keep it linear.
function trimZeros(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === '0') end -= 1;
  if (text[end - 1] === '.') end -= 1;
  return text.slice(0, end);
}

// In US dollars: "0 USD" for free models, otherwise up to six decimals without trailing
// zeros, e.g. "0.000123 USD". Below a millionth it shows "< 0.000001 USD".
function formatCost(spend) {
  if (!spend || (spend.cost === 0 && !spend.complete)) return 'unknown';
  let amount;
  if (spend.cost === 0) amount = '0 USD';
  else if (spend.cost < 0.000001) amount = '< 0.000001 USD';
  else amount = `${trimZeros(spend.cost.toFixed(6))} USD`;
  return spend.complete ? amount : `≥ ${amount}`;
}

module.exports = { newSpend, addCost, formatCost };
