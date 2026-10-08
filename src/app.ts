import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import routes from './routes';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(routes);

app.listen(port, () => {
  console.log(`🚀 Freshdesk Cleanup Server running on http://localhost:${port}`);
  console.log(`📡 Ready to receive POST http://localhost:${port}/delete-all-contacts`);
});

export default app;
