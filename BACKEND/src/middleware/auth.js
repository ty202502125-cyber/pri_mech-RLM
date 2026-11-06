const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function requireAuth(request, response, next) {
  try {
    const token = request.cookies?.session;
    if (!token) return response.status(401).json({ error: 'Please sign in to continue.' });
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, role FROM users WHERE id = ? AND is_active = 1',
      [claims.sub],
    );
    if (!rows.length) return response.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
    request.user = rows[0];
    next();
  } catch (error) {
    if (['ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE'].includes(error.code)) {
      return next(error);
    }
    response.status(401).json({ error: 'Your session could not be verified. Please sign in again.' });
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') {
    return response.status(403).json({ error: 'Mechanic administrator access is required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
