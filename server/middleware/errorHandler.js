export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'שגיאת שרת פנימית';
  if (process.env.NODE_ENV !== 'production') console.error(err);
  res.status(status).json({ success: false, error: message });
}

export function notFound(req, res) {
  res.status(404).json({ success: false, error: `לא נמצא: ${req.originalUrl}` });
}

// Wrap async route handlers so errors propagate to errorHandler
export const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
