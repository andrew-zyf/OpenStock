import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

// Prefer IPv4 while keeping system DNS resolver intact (do not hardcode 8.8.8.8)
import dns from 'dns';
try {
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }
} catch (e) {
    console.error('Failed to set DNS result order:', e);
}

declare global {
    var mongooseCache: {
        conn: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
    }
}

let cached = global.mongooseCache;

if (!cached) {
    cached = global.mongooseCache = { conn: null, promise: null };
}

export const connectToDatabase = async () => {
    if (!MONGODB_URI) {
        throw new Error("MongoDB URI is missing");
    }

    if (cached.conn) return cached.conn;

    if (!cached.promise) {
        cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false, family: 4 });
    }

    try {
        cached.conn = await cached.promise;
    }
    catch (err) {
        cached.promise = null;
        throw err;
    }

    console.log(`MongoDB Connected ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')} in ${process.env.NODE_ENV}`);
    return cached.conn;
}