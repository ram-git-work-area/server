FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/location-service/dist ./apps/location-service/dist
USER node
EXPOSE 3007
CMD ["node", "apps/location-service/dist/server.js"]
