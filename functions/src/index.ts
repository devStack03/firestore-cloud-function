import * as functions from "firebase-functions";
import * as admin from 'firebase-admin';
import { FieldValue } from '@google-cloud/firestore';

admin.initializeApp();

const DOCUMENT_TOTAL = 'total';
const DOCUMENT_RAINFALL = 'rainfall';

exports.addRainfall = functions.https.onRequest(async (req, res) => {
  const { amount, notes } = req.query;
  const writeResult =
    await admin
      .firestore()
      .collection(DOCUMENT_RAINFALL)
      .add({
        amount: parseFloat(amount as string),
        created_at: FieldValue.serverTimestamp(),
        notes
      });

  res.json({ result: `new document ID: ${writeResult.id} added.` });
});

// onCreate
exports.summarizeAmountOnCreate = functions.firestore.document(`${DOCUMENT_RAINFALL}/{documentId}`)
  .onCreate(async (snap, context) => {

    functions.logger.log('new rainfall added', context.params.documentId);
    const { amount, created_at } = snap.data();
    if (amount && created_at) {
      const { year, month } = getYearAndMonth(created_at.toDate());
      functions.logger.log(`Year : ${year} ,  Month: ${month}`);
      return await increaseData(year, month, amount);
    }
    return null;
  });

exports.summarizeAmountOnUpdate = functions.firestore.document(`${DOCUMENT_RAINFALL}/{documentId}`)
  .onUpdate(async (change, context) => {
    functions.logger.log("onUpdate", context.params.documentId);
    const newValue = change.after.data();
    const previousValue = change.before.data();
    if (newValue.amount === previousValue.amount) return;

    const newAmount = newValue.amount;
    const newCreatedAt = newValue.created_at;
    const preAmount = previousValue.amount;
    const preCreatedAt = previousValue.created_at;

    // minus previous value from original year and month
    const { year: preYear, month: preMonth } = getYearAndMonth(preCreatedAt.toDate());
    await reduceData(preYear, preMonth, preAmount);
    // plus or create new value
    const { year: newYear, month: newMonth } = getYearAndMonth(newCreatedAt.toDate());

    return await increaseData(newYear, newMonth, newAmount);
  });

exports.summarizeAmountOnDelete = functions.firestore.document(`${DOCUMENT_RAINFALL}/{documentId}`)
  .onDelete(async (snap, context) => {
    functions.logger.log('onDelete', context.params.documentId);
    const deletedValue = snap.data();
    const preAmount = deletedValue.amount;
    const preCreatedAt = deletedValue.created_at;
    // minus previous value from original year and month
    const { year: preYear, month: preMonth } = getYearAndMonth(preCreatedAt.toDate());
    return await reduceData(preYear, preMonth, preAmount);
  });

const getYearAndMonth = (date: Date) => {
  const year = date.getFullYear();
  const month = date.toLocaleString('default', { month: 'short' });

  return { year, month };
};

const summaryData = async (docId: number) => {
  const docSnapshot = await admin.firestore().collection(DOCUMENT_TOTAL).doc(`${docId}`).get();
  return docSnapshot.data();
};

const reduceData = async (preYear: number, preMonth: string, preAmount: number) => {
  const preDoc = await summaryData(preYear);
  if (preDoc) {
    let decreasedValue = preDoc['monthly'][`${preMonth}`] - preAmount;
    let decreasedTotalValue = preDoc['total'] - preAmount;
    const updateResult =
      await admin
        .firestore()
        .collection(DOCUMENT_TOTAL)
        .doc(`${preYear}`)
        .set(
          {
            monthly: {
              [preMonth]: decreasedValue
            },
            total: decreasedTotalValue
          },
          { merge: true }
        );
    return updateResult;
  }
  return Promise.reject(null);
}

const increaseData = async (newYear: number, newMonth: string, newAmount: number) => {
  const preDoc = await summaryData(newYear);
  if (preDoc) {
    let monthValue = preDoc['monthly'][`${newMonth}`];
    let totalValue = preDoc['total'];
    functions.logger.log(`monthValue: ${monthValue}`);

    if (totalValue) {
      totalValue += newAmount;
    } else {
      totalValue = newAmount;
    }

    if (monthValue) {
      monthValue += newAmount;
    } else {
      monthValue = newAmount;
    }

    const updateResult =
      await admin
        .firestore()
        .collection(DOCUMENT_TOTAL)
        .doc(`${newYear}`)
        .set(
          {
            monthly: {
              [newMonth]: monthValue
            },
            total: totalValue
          },
          { merge: true }
        );
    return updateResult;
  } else {

    // new create
    const nResult =
      await admin
        .firestore()
        .collection(DOCUMENT_TOTAL)
        .doc(`${newYear}`)
        .set(
          {
            monthly: {
              [newMonth]: newAmount
            },
            total: newAmount
          },
          { merge: true }
        );
    return nResult;
  }
}
