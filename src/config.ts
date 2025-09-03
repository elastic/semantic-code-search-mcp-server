import dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const elasticsearchConfig = {
  endpoint: process.env.ELASTICSEARCH_ENDPOINT,
  cloudId: process.env.ELASTICSEARCH_CLOUD_ID,
  username: process.env.ELASTICSEARCH_USER,
  password: process.env.ELASTICSEARCH_PASSWORD,
  apiKey: process.env.ELASTICSEARCH_API_KEY,
  index: process.env.ELASTICSEARCH_INDEX || 'semantic-code-search',
};
