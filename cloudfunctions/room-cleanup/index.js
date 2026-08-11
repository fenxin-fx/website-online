const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

exports.main = async () => {
  const expired = await db.collection("duel_rooms")
    .where({ expiresAt: db.command.lte(Date.now()) })
    .limit(100)
    .get();
  await Promise.all(expired.data.map((room) => db.collection("duel_rooms").doc(room._id).remove()));
  return { ok: true, removed: expired.data.length };
};
