module.exports = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.redirect('/login');
    };
    next();
};
