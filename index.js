const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const uri = process.env.MONGO_URI;
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});



var serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


async function run() {
  try {
    // await client.connect();
    const parcelCollection = client.db("parcelDB").collection("parcels");
    const paymentCollection = client.db("parcelDB").collection("payments");
    const usersCollection = client.db("parcelDB").collection("users");
    const ridersCollection = client.db("parcelDB").collection("riders")



    console.log("✅ Connected to MongoDB");

    // custom middleware

    const verifyFbToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized Access' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized Access' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // Save user info for next middleware/route
    next();
  } catch (error) {
    console.error('❌ Firebase Token verification failed:', error);
    return res.status(403).send({ message: 'Forbidden' });
  }

}

const verifyAdminToken = async (req, res, next)=> {
  const email = req.user?.email;
  console.log(email)
  const query ={ email};
  const user = await usersCollection.findOne(query);
  if(!user || user.role !== 'admin'){
    return res.status(403).send({message: "forbidden access"})
  }
  next()
}

    

    app.get('/users/role/:email', async (req, res) => {
            try {
                const email = req.params.email;
                console.log(email)
                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

    
   app.get("/parcels", async (req, res) => {
  try {
     
     const {email, paymentStatus, delivery_status}  = req.query;
     
    
    let query ={}
    if(email){
      query= {created_by : email}
     
    }
    if(paymentStatus){
      query.paymentStatus = paymentStatus
    }

    if(delivery_status){
      query.delivery_status =delivery_status
    }

    const options = {
                    sort: { createdAt: -1 }, // Newest first
                };
   

    const parcels = await parcelCollection
      .find(query,options).toArray();

    res.send(parcels);
  } catch (err) {
    console.error("❌ Error fetching parcels:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });

        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("Error fetching parcel by ID:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

  
app.get('/rider/parcels',verifyFbToken, async (req, res) => {
  try {
    const email = req.user.email;
    console.log(email)

    const parcels = await parcelCollection.find({
      assigned_rider_email: email,
      delivery_status: { $in: ["rider_assigned", "in_transit"] }
    }).toArray();

    res.send(parcels);
  } catch (error) {
    console.error("❌ Failed to fetch rider parcels:", error);
    res.status(500).send({ message: "Server error fetching rider parcels" });
  }
});

    
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;
        const result = await parcelCollection.insertOne(parcel);
        res.status(201).json({ message: "✅ Parcel added", insertedId: result.insertedId });
      } catch (err) {
        console.error("❌ Error inserting parcel:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    app.patch("/parcels/:id/assign",verifyFbToken,verifyAdminToken, async (req, res) => {
            const parcelId = req.params.id;
            const { riderId, riderName,riderEmail } = req.body;

            try {
                // Update parcel
                await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status: "rider_assigned",
                            assigned_rider_id: riderId,
                            assigned_rider_name: riderName,
                            assigned_rider_email:riderEmail
                        },
                    }
                );

                // Update rider
                await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    {
                        $set: {
                            work_status: "in_delivery",
                        },
                    }
                );

                res.send({ message: "Rider assigned" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to assign rider" });
            }
        });

   app.patch("/parcels/:id/status", async (req, res) => {
            const parcelId = req.params.id;
            const { status } = req.body;
            const updatedDoc = {
                delivery_status: status
            }

            if (status === 'in_transit') {
                updatedDoc.picked_at = new Date().toISOString()
            }
            else if (status === 'delivered') {
                updatedDoc.delivered_at = new Date().toISOString()
            }

            try {
                const result = await parcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: updatedDoc
                    }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to update status" });
            }
        });      

    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post('/users', async (req, res) => {
      const email = req.body.email;

      if (!email) {
        return res.status(400).send({ message: 'Email is required' });
      }

      const existingUser = await usersCollection.findOne({ email });

      if (existingUser) {
        // update last login time
        return res.send({ message: 'User already exists', inserted: false });
      }

      // Add default role and timestamps
      const user = req.body;

      const result = await usersCollection.insertOne(user);
      res.send({ message: 'New user created', insertedId: result.insertedId });
    });


    app.post('/tracking', async (req, res) => {
      try {
        const trackingUpdate = req.body; // { trackingId, status, timestamp, location }
        const result = await trackingCollection.insertOne(trackingUpdate);
        res.send(result);
      } catch (error) {
        console.error("POST /tracking error:", error);
        res.status(500).send({ error: 'Failed to add tracking update' });
      }
    });


    // payment related api
    app.get('/payments', verifyFbToken,verifyAdminToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        if (req.user.email !== userEmail) {
          return res.status(403).send({ message: 'Forbidden' });
        }


        const query = userEmail ? { email: userEmail } : {};
        const options = { sort: { paid_at: -1 } }; // Latest first
        const payments = await paymentCollection.find(query, options).toArray();
        res.send(payments);


      } catch (error) {
        console.error("Error in GET /payments:", error);
        res.status(500).send({ error: 'Failed to load payment history' });
      }
    });



    app.post('/payments', async (req, res) => {
      const { parcelId, email, amount, paymentMethod, transactionId } = req.body;



      const paymentDoc = {
        transactionId,
        email,
        parcelId,
        paymentMethod,
        amount,
        status: 'paid',
        paid_at_string: new Date().toISOString(),
        paid_at: new Date()
      };

      try {
        // Save payment history
        const paymentResult = await paymentCollection.insertOne(paymentDoc);

        // Update parcel's payment status
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { paymentStatus: 'paid' } }
        );

        res.send({
          message: 'Payment recorded and parcel updated successfully',
          insertedId: paymentResult.insertedId,
          paymentResult,
          updateResult
        });

      } catch (error) {
        console.error('Error saving payment:', error);
        res.status(500).send({ error: 'Payment failed to record' });
      }
    });



    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: 1000, // Amount in cents
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // riders api
    app.get('/riders/pending',verifyFbToken,verifyAdminToken, async (req, res) => {
      try {
        const riders = await ridersCollection.find({ status: "pending" }).toArray();
        res.send(riders);
      } catch (error) {
        console.error("❌ Error fetching riders:", error);
        res.status(500).send({ message: "Failed to fetch riders" });
      }
    });


 // GET /users/search?email=xyz
    app.get('/users/search', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "missing email query" })
      }
      const regex = new RegExp(email, "i")
      try {
        const users = await usersCollection.find({ email: { $regex: regex } }).limit(10).toArray();
        res.send(users);
      }
      catch (error) {
        console.error("Error searching users", error);
        res.status(500).send({ message: "Error searching users" });
      }

    });



    // PUT /users/admin/:email
    app.put('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const makeAdmin = req.body.isAdmin;

      const result = await usersCollection.updateOne(
        { email: email },
        { $set: { role: makeAdmin ? "admin" : "user" } }
      );

      res.send(result);
    });

    app.get('/riders', async (req, res) => {
  try {
    const riders = await ridersCollection.find().toArray();
    res.send(riders);
  } catch (error) {
    console.error("❌ Error fetching all riders:", error);
    res.status(500).send({ message: "Failed to fetch riders" });
  }
});

    app.post('/riders', async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider)
      res.send(result)
    })
    app.patch('/riders/:id/status', async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;
      console.log(id)
      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, approvedAt: new Date() } }
      );

      // update user status for accepting rider
      if (status === "active") {
        const userQuery = { email };
        const userUpdatedDoc = {
          $set: {
            role: 'rider'
          }
        }
        const roleResult = await usersCollection.updateOne(userQuery, userUpdatedDoc)
        console.log(roleResult.modifiedCount)
      }

      res.send(result);
    });

    app.get('/riders/active', async (req, res) => {
      try {
        const riders = await ridersCollection.find({ status: 'active' }).toArray();
        res.send(riders);
      } catch (error) {
        console.error("❌ Error fetching active riders:", error);
        res.status(500).send({ message: "Failed to fetch active riders" });
      }
    });
    app.get("/riders/available", async (req, res) => {
            const { district } = req.query;
            console.log(district)

            try {
                const riders = await ridersCollection
                    .find({
                        sender_center:district,
                        // status: { $in: ["approved", "active"] },
                        // work_status: "available",
                    })
                    .toArray();

                res.send(riders);
            } catch (err) {
                res.status(500).send({ message: "Failed to load riders" });
            }
        });

    app.delete('/riders/:id', async (req, res) => {
      const id = req.params.id;
      const result = await ridersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
  }
}
run().catch(console.dir);



//custom middlewares





// parcels api





// Default Route
app.get("/", (req, res) => {
  res.send("📦 Parcel Server Running...");
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});


