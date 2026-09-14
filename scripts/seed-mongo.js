const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb+srv://sumit345jangra_db_user:sumit88148@cluster0.qkxvsjs.mongodb.net/xerox?retryWrites=true&w=majority&appName=Cluster0';

async function seed() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('xerox');

  // Seed orders
  const ordersFile = path.join(__dirname, '..', 'data', 'orders.json');
  if (fs.existsSync(ordersFile)) {
    const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    for (const ord of orders) {
      await db.collection('orders').updateOne(
        { orderId: ord.orderId },
        { $set: ord },
        { upsert: true }
      );
    }
    console.log('Seeded orders:', orders.length);
  }

  // Seed notifications
  const notifsFile = path.join(__dirname, '..', 'data', 'notifications.json');
  if (fs.existsSync(notifsFile)) {
    const notifs = JSON.parse(fs.readFileSync(notifsFile, 'utf8'));
    for (const n of notifs) {
      await db.collection('notifications').updateOne(
        { orderId: n.orderId },
        { $set: n },
        { upsert: true }
      );
    }
    console.log('Seeded notifications:', notifs.length);
  }

  // Seed files
  const filesFile = path.join(__dirname, '..', 'data', 'files.json');
  if (fs.existsSync(filesFile)) {
    const files = JSON.parse(fs.readFileSync(filesFile, 'utf8'));
    for (const f of files) {
      await db.collection('files').updateOne(
        { id: f.id },
        { $set: f },
        { upsert: true }
      );
    }
    console.log('Seeded files:', files.length);
  }

  await client.close();
  console.log('MongoDB Atlas seeding finished!');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
