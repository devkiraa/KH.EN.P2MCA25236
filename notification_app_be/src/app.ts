import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import notificationRoutes from './routes/notification.routes';
import { errorMiddleware } from './middleware/error.middleware';
import { setAuthToken } from '../../logging_middleware';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

setAuthToken(process.env.ACCESS_TOKEN || process.env.API_TOKEN || '');

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Backend is running' });
});

app.use('/api', notificationRoutes);
app.use(errorMiddleware);

app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});