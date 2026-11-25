'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const { connectDB, closeDB, DB_NAME } = require('./db/connection');
const { seedInitialUsers } = require('./db/seedUsers');
const { seedInitialPatients } = require('./db/seedPatients');
const { seedInitialRadiologyOrders } = require('./db/seedRadiologyOrders');
const { seedInitialMedicines } = require('./db/seedMedicines');
const prescriptionRepository = require('./repositories/prescriptionRepository');
const injectionRepository = require('./repositories/injectionRepository');
const mealOrderRepository = require('./repositories/mealOrderRepository');
const rehabOrderRepository = require('./repositories/rehabOrderRepository');
const bedMovementRepository = require('./repositories/bedMovementRepository');
const outpatientReceptionRepository = require('./repositories/outpatientReceptionRepository');
const patientRepository = require('./repositories/patientRepository');
const userRepository = require('./repositories/userRepository');
const roleOrderRepository = require('./repositories/roleOrderRepository');
const { formatActorForRecord } = require('./utils/actorHelper');
const { DEFAULT_ROLE_ORDER_PERMISSIONS } = require('./config/constants');
const authRoutes = require('./routes/authRoutes');
const bedboardRoutes = require('./routes/bedboardRoutes');
const outpatientReceptionRoutes = require('./routes/outpatientReceptionRoutes');
const workspaceRoutes = require('./routes/workspaceRoutes');
const userRoutes = require('./routes/userRoutes');
const patientRoutes = require('./routes/patientRoutes');
const radiologyRoutes = require('./routes/radiologyRoutes');
const medicineRoutes = require('./routes/medicineRoutes');
const prescriptionRoutes = require('./routes/prescriptionRoutes');
const injectionRoutes = require('./routes/injectionRoutes');
const mealRoutes = require('./routes/mealRoutes');
const rehabRoutes = require('./routes/rehabRoutes');

const PORT = Number(process.env.PORT || 80);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    name: 'ordering.sid',
    secret: process.env.SESSION_SECRET || 'ordering-system-session-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

app.use(async (req, res, next) => {
  res.locals.availableDoctors = [];
  res.locals.actorDisplayName = '';
  if (req.session && req.session.user) {
    res.locals.actorDisplayName = formatActorForRecord(req.session.user);
    if (!req.path.startsWith('/api/')) {
      try {
        const docs = await userRepository.findActiveDoctors();
        res.locals.availableDoctors = docs.map((d) => ({
          staffId: d.staffId,
          fullName: d.fullName,
          defaultDepartmentCode: d.defaultDepartmentCode
        }));
      } catch (_) {}
    }
  }
  next();
});

app.use('/', authRoutes);
app.use('/', bedboardRoutes);
app.use('/', outpatientReceptionRoutes);
app.use('/', workspaceRoutes);
app.use('/', userRoutes);
app.use('/', patientRoutes);
app.use('/', radiologyRoutes);
app.use('/', medicineRoutes);
app.use('/', prescriptionRoutes);
app.use('/', injectionRoutes);
app.use('/', mealRoutes);
app.use('/', rehabRoutes);

app.use((err, req, res, _next) => {
  console.error('[Ordering Error]', err);
  res.status(500).send('サーバー内部エラーが発生しました。');
});

async function start() {
  await connectDB();
  await seedInitialUsers();
  await seedInitialPatients();
  await seedInitialRadiologyOrders();
  await seedInitialMedicines();
  await prescriptionRepository.ensureIndexes();
  await injectionRepository.ensureIndexes();
  await mealOrderRepository.ensureIndexes();
  await rehabOrderRepository.ensureIndexes();
  await bedMovementRepository.ensureIndexes();
  await outpatientReceptionRepository.ensureIndexes();
  await outpatientReceptionRepository.seedInitialIfEmpty(await patientRepository.findAll());
  await roleOrderRepository.seedDefaults(DEFAULT_ROLE_ORDER_PERMISSIONS);

  const server = app.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    const url = PORT === 80 ? `http://${displayHost}/login` : `http://${displayHost}:${PORT}/login`;
    console.log(`オーダリングシステム起動: ${url} (Bind: ${HOST}:${PORT} / DB: ${DB_NAME})`);
  });

  server.on('error', (err) => {
    if (err.code === 'EACCES') {
      console.error(`ポート ${PORT} のバインド権限がありません。`);
      console.error(`次のコマンドで Node.js に権限を付与するか、管理者権限で起動してください:`);
      console.error(`  sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))`);
      process.exit(1);
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`ポート ${PORT} はすでに別プロセスで使用中です。`);
      process.exit(1);
    }
    throw err;
  });

  const shutdown = async () => {
    server.close(async () => {
      await closeDB();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((err) => {
    console.error('起動に失敗しました:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
