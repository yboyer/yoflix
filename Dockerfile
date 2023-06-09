FROM node:lts-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn
COPY . .
CMD yarn start
