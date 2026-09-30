FROM node:26.9-alpine3.24 AS builder
WORKDIR /app
COPY package.json .
COPY *.js .
RUN npm install

FROM node:26.9-alpine3.24
WORKDIR /app
EXPOSE 8080
COPY --from=builder /app /app
ENV MONGO="true" \
    MONGO_URL="mongodb://mongodb:27017/catalogue"
RUN addgroup -S roboshop && adduser -S roboshop -G roboshop
RUN chown -R roboshop:roboshop /app
USER roboshop
CMD ["server.js"] 
ENTRYPOINT ["node"] 

# FROM node:20
# # crete and runs all below commadns on this directory
# WORKDIR /app
# COPY package.json .
# COPY *.js .
# RUN npm install
# ENV MONGO="true" \
#     MONGO_URL="mongodb://mongodb:27017/catalogue"
# CMD ["node", "server.js"]
