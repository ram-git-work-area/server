import mongoose, { type ConnectOptions } from 'mongoose';

export async function connectMongo(mongoUrl: string) {
  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const options: ConnectOptions = {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 20,
  };

  await mongoose.connect(mongoUrl, options);

  return mongoose.connection;
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
