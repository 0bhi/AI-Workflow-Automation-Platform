FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.json next.config.mjs postcss.config.mjs tailwind.config.ts styles.css ./
RUN npm install

COPY app ./app
COPY components ./components

EXPOSE 3000

CMD ["npm", "run", "dev"]


