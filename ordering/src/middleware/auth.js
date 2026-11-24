'use strict';

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '認証が必要です。ログインしてください。' });
  }
  return res.redirect('/login');
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.user && req.session.user.landingPath) {
    return res.redirect(req.session.user.landingPath);
  }
  return next();
}

module.exports = {
  requireAuth,
  redirectIfAuthenticated
};
