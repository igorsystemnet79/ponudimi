const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ponudimi-mvp-change-this-secret';

if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL is not set. Configure a PostgreSQL database before deploying.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('individual','company')),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      company_name TEXT,
      pib TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS listings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      price NUMERIC,
      description TEXT,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      category TEXT,
      location TEXT,
      budget NUMERIC,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const seedUsers = [
    ['individual','Demo Korisnik','fizicko@ponudimi.local',bcrypt.hashSync('Demo123!',10),null,null],
    ['company','Demo Firma','firma@ponudimi.local',bcrypt.hashSync('Demo123!',10),'Demo Firma d.o.o.','100000001']
  ];
  for (const u of seedUsers) {
    await pool.query(
      `INSERT INTO users(type,name,email,password_hash,company_name,pib)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING`, u
    );
  }

  const countResult = await pool.query('SELECT COUNT(*)::int AS c FROM listings');
  if (countResult.rows[0].c === 0) {
    const demo = [
      ['Polovni automobili','BMW 520d xDrive','Beograd',24900,'2019 • 142.000 km','/assets/hero-reference.png'],
      ['Nekretnine','Stan 58m² - Novi Beograd','Novi Beograd',154000,'2.0 soban • novogradnja','/assets/hero-reference.png'],
      ['Mobilni telefoni','iPhone 14 Pro 128GB','Novi Sad',799,'Kao nov • garancija','/assets/hero-reference.png'],
      ['Usluge','Majstor za adaptaciju kupatila','Niš',null,'Kompletna adaptacija po dogovoru','/assets/hero-reference.png']
    ];
    const userResult = await pool.query("SELECT id FROM users WHERE email='fizicko@ponudimi.local' LIMIT 1");
    const userId = userResult.rows[0]?.id || null;
    for (const x of demo) {
      await pool.query(
        `INSERT INTO listings(user_id,title,category,location,price,description,image)
         VALUES($1,$2,$3,$4,$5,$6,$7)`, [userId,x[1],x[0],x[2],x[3],x[4],x[5]]
      );
    }
  }
}

app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

function auth(req,res,next){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Potrebna je prijava.'});
  try { req.user=jwt.verify(h.slice(7),JWT_SECRET); next(); }
  catch { return res.status(401).json({error:'Sesija je istekla.'}); }
}

app.get('/api/health',async(req,res)=>{
  try { await pool.query('SELECT 1'); res.json({ok:true,app:'PonudiMi MVP v1',database:'postgresql'}); }
  catch { res.status(503).json({ok:false,app:'PonudiMi MVP v1',database:'unavailable'}); }
});

app.get('/api/categories',(req,res)=>res.json([
  'Polovni automobili','Nekretnine','Mobilni telefoni','Tehnika','Usluge','Građevina','Poljoprivreda','Moda','Ostalo'
]));

app.get('/api/listings',async(req,res)=>{
  try {
    const q=(req.query.q||'').trim(); const category=(req.query.category||'').trim(); const location=(req.query.location||'').trim();
    let sql='SELECT id,title,category,location,price,description,image,created_at FROM listings WHERE 1=1'; const args=[];
    if(q){args.push(`%${q}%`);sql+=` AND (title ILIKE $${args.length} OR description ILIKE $${args.length})`;}
    if(category){args.push(category);sql+=` AND category=$${args.length}`;}
    if(location){args.push(`%${location}%`);sql+=` AND location ILIKE $${args.length}`;}
    sql+=' ORDER BY id DESC LIMIT 50';
    const result=await pool.query(sql,args); res.json(result.rows);
  } catch(e) { console.error(e); res.status(500).json({error:'Greška pri učitavanju oglasa.'}); }
});

app.post('/api/auth/register',async(req,res)=>{
  const {type,name,email,password,companyName,pib}=req.body;
  if(!['individual','company'].includes(type)||!name||!email||!password) return res.status(400).json({error:'Popunite obavezna polja.'});
  if(type==='company' && !companyName) return res.status(400).json({error:'Naziv firme je obavezan.'});
  if(password.length<6) return res.status(400).json({error:'Lozinka mora imati najmanje 6 karaktera.'});
  try {
    const result=await pool.query(
      `INSERT INTO users(type,name,email,password_hash,company_name,pib)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [type,name,email.toLowerCase(),bcrypt.hashSync(password,10),companyName||null,pib||null]
    );
    const user={id:result.rows[0].id,type,name,email:email.toLowerCase(),companyName:companyName||null};
    const token=jwt.sign(user,JWT_SECRET,{expiresIn:'7d'}); res.status(201).json({token,user});
  } catch(e) {
    if(e.code==='23505') return res.status(409).json({error:'Email je već registrovan.'});
    console.error(e); res.status(500).json({error:'Greška pri registraciji.'});
  }
});

app.post('/api/auth/login',async(req,res)=>{
  try {
    const {email,password}=req.body;
    const result=await pool.query('SELECT * FROM users WHERE email=$1 LIMIT 1',[(email||'').toLowerCase()]);
    const row=result.rows[0];
    if(!row||!bcrypt.compareSync(password||'',row.password_hash)) return res.status(401).json({error:'Pogrešan email ili lozinka.'});
    const user={id:row.id,type:row.type,name:row.name,email:row.email,companyName:row.company_name};
    res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:'7d'}),user});
  } catch(e) { console.error(e); res.status(500).json({error:'Greška pri prijavi.'}); }
});

app.get('/api/me',auth,(req,res)=>res.json(req.user));

app.post('/api/listings',auth,async(req,res)=>{
  try {
    const {title,category,location,price,description}=req.body;
    if(!title||!category||!location) return res.status(400).json({error:'Naslov, kategorija i lokacija su obavezni.'});
    const result=await pool.query(
      `INSERT INTO listings(user_id,title,category,location,price,description,image)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user.id,title,category,location,price?Number(price):null,description||'','/assets/hero-reference.png']
    );
    res.status(201).json({id:result.rows[0].id});
  } catch(e) { console.error(e); res.status(500).json({error:'Greška pri objavljivanju oglasa.'}); }
});

app.post('/api/requests',auth,async(req,res)=>{
  try {
    const {title,category,location,budget,description}=req.body;
    if(!title) return res.status(400).json({error:'Naslov zahteva je obavezan.'});
    const result=await pool.query(
      `INSERT INTO requests(user_id,title,category,location,budget,description)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id,title,category||null,location||null,budget?Number(budget):null,description||'']
    );
    res.status(201).json({id:result.rows[0].id});
  } catch(e) { console.error(e); res.status(500).json({error:'Greška pri slanju zahteva.'}); }
});

app.post('/api/support/tickets',async(req,res)=>{
  try {
    const {name,email,subject,message}=req.body;
    if(!name||!email||!subject||!message) return res.status(400).json({error:'Popunite sva polja.'});
    const result=await pool.query(
      `INSERT INTO support_tickets(name,email,subject,message) VALUES($1,$2,$3,$4) RETURNING id`,
      [name,email,subject,message]
    );
    res.status(201).json({id:result.rows[0].id,message:'Upit je uspešno evidentiran.'});
  } catch(e) { console.error(e); res.status(500).json({error:'Greška pri slanju upita.'}); }
});

const faq=[
 {keys:['registr','fizičko','fizicko'],answer:'Za fizičko lice izaberite Registracija → Fizičko lice i popunite osnovne podatke. U MVP-u se nalog odmah aktivira nakon uspešne registracije.'},
 {keys:['firma','pravno','paket'],answer:'Za firmu izaberite Registracija → Pravno lice. U punoj verziji ovde će biti prikazani paketi i uslovi zakupa.'},
 {keys:['prijav','login','ulog'],answer:'Za prijavu koristite email i lozinku. Ako ste zaboravili lozinku, u punoj verziji koristićemo proceduru za resetovanje putem emaila.'},
 {keys:['oglas','objav'],answer:'Oglas možete objaviti preko dugmeta „Objavi oglas“. Potrebna je prijava. Unesite naslov, kategoriju, lokaciju, cenu i opis.'},
 {keys:['zahtev','ponud'],answer:'„Postavi zahtev“ služi kupcu da opiše šta traži. Registrovani ponuđači kasnije mogu da odgovore ponudom.'},
 {keys:['lozink','šifru','sifru'],answer:'Ako ste zaboravili lozinku, u MVP-u kontaktirajte podršku kroz „Pošalji upit“. Produkcijska verzija će imati automatski reset lozinke.'}
];
app.post('/api/support/chat',(req,res)=>{
 const message=(req.body.message||'').toLowerCase();
 const found=faq.find(x=>x.keys.some(k=>message.includes(k)));
 res.json({answer:found?found.answer:'Mogu da pomognem oko registracije, prijave, oglasa, zahteva i paketa za firme. Ako pitanje nije pokriveno, koristite „Pošalji upit“.'});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

initDb()
  .then(()=>app.listen(PORT,()=>console.log(`PonudiMi MVP v1 running on port ${PORT}`)))
  .catch(err=>{ console.error('Database initialization failed:',err); process.exit(1); });
