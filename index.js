const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qknp5zk.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        });

        /**
         * warning:
         * This is not the proper way to query
         * After learning more about mongodb. use aggregate lookup, pipeline, match, group
         */
        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // step: 1 get all services
            const services = await serviceCollection.find().toArray();

            // step: 2 get the booking of that day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // step: 3 for each service
            services.forEach((service) => {
                // step: 4 find bookings for that service
                const serviceBookings = bookings.filter((book) => book.treatment === service.name);
                // step: 5 select slots for the service bookings
                const bookedSlots = serviceBookings.map((book) => book.slot);
                // step: 6 select those slot that are not in bookedSlots
                const available = service.slots.filter((slot) => !bookedSlots.includes(slot));
                service.slots = available;
            });

            res.send(services);
        });

        app.get('/booking', async (req, res) => {
            const patient = req.query.patient;
            const query = { patient: patient };
            const bookings = await bookingCollection.find(query).toArray();
            res.send(bookings);
        });

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists });
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result });
        });
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
