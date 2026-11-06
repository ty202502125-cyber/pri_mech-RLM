const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const privateProofDirectory = path.resolve(__dirname, '../../private-uploads/payment-proofs');

function parseProofDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|png)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return null;
  const validSignature = match[1] === 'image/jpeg'
    ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : match[1] === 'image/png'
      ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!validSignature) return null;
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1] === 'image/png' ? 'png' : 'pdf';
  return { buffer, extension };
}

async function saveProof(proof) {
  await fs.mkdir(privateProofDirectory, { recursive: true });
  const filename = `${crypto.randomUUID()}.${proof.extension}`;
  const fullPath = path.join(privateProofDirectory, filename);
  await fs.writeFile(fullPath, proof.buffer, { flag: 'wx' });
  return { filename, fullPath };
}

async function updatePaymentSummary(connection, paymentId) {
  const [[summary]] = await connection.execute(
    `SELECT p.final_amount, p.estimated_amount,
       COALESCE(SUM(CASE WHEN pt.status = 'verified' THEN pt.amount ELSE 0 END), 0) AS verified_total,
       COALESCE(SUM(pt.status IN ('pending', 'submitted')), 0) AS pending_count,
       COALESCE(SUM(pt.status = 'refunded'), 0) AS refund_count
     FROM payments p LEFT JOIN payment_transactions pt ON pt.payment_id = p.id
     WHERE p.id = ? GROUP BY p.id`,
    [paymentId],
  );
  const target = Number(summary.final_amount ?? summary.estimated_amount ?? 0);
  const verified = Number(summary.verified_total);
  const status = verified > 0
    ? (target > 0 && verified >= target ? 'paid' : 'partially_paid')
    : (Number(summary.refund_count) > 0 ? 'refunded' : 'pending');
  await connection.execute('UPDATE payments SET status = ? WHERE id = ?', [status, paymentId]);
  return { target, verified, status, pendingCount: Number(summary.pending_count) };
}

module.exports = { privateProofDirectory, parseProofDataUrl, saveProof, updatePaymentSummary };
