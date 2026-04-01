# Use an official Node.js runtime as the base image
FROM node:18-slim

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy local code to the container image
COPY . .

# Service must listen to $PORT environment variable.
# Cloud Run sets this to 8080 by default.
ENV PORT 8080

# Run the web service on container startup
CMD [ "node", "server.js" ]
