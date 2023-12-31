const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const nodemailer = require('nodemailer');
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

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).send({ message: 'UnAuthorized Access' });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        req.decoded = decoded;
        next();
    });
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    // secure: true,
    auth: {
        // api_key: process.env.SMTP_API_KEY,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

function sendAppointmentEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking;

    transporter.sendMail(
        {
            from: process.env.SMTP_USER,
            to: patient,
            subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
            text: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
            html: `
            <div>
                <p> Hello ${patientName}, </p>
                <h3>Your Appointment for ${treatment} is confirmed</h3>
                <p>Looking forward to seeing you on ${date} at ${slot}.</p>

                <h3>Our Address</h3>
                <p>Santosh, Tangail<p>
                <p>Bangladesh<p>

            </div>
        `,
        },
        function (err, info) {
            if (err) {
                console.log(err);
            } else {
                console.log('Message sent: ', info.response);
            }
        }
    );
}

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const userCollection = client.db('doctors_portal').collection('users');
        const doctorCollection = client.db('doctors_portal').collection('doctors');

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            } else {
                res.status(403).send({ message: 'Forbidden' });
            }
        };

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);
        });

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });

        app.get('/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        });

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });
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

        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req?.decoded?.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            } else {
                return res.status(403).send({ message: 'forbidden access' });
            }
        });

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists });
            }
            const result = await bookingCollection.insertOne(booking);
            console.log('sending email');
            sendAppointmentEmail(booking);
            return res.send({ success: true, result });
        });

        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        });

        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        });

        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
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
