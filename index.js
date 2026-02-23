const express = require('express');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse'); 
const { Gasto,Regla, iniciarDB } = require('./database');


const app = express();
const upload = multer({ dest: 'uploads/' }); 

app.use(express.static('public')); 
app.use(express.json());
// chismoso global para ver qué llega
app.use((req, res, next) => {
    console.log(`Petición recibida: ${req.method} ${req.url}`);
    next();
});

//cerebro de aprendizaje
let diccionario =[]

//funcion para cargar lo que la app aprende desde la bd a su memoria
async function actualizarCerebro(){
    diccionario = await Regla.findAll();
}

// categorizador
function categorizar(texto) {
    if (!texto) return 'Varios';
    const t = texto.toLowerCase();

    //busca en lo que le enseñe
    for (let regla of diccionario){
        if(t.includes(regla.palabraClave)){
            return regla.categoria;
        }
    }
    //si no lo conoce usa estas reglas basicas
    if (t.includes('super') || t.includes('coto') || t.includes('carrefour') || t.includes('dia') || t.includes('jumbo') || t.includes('vea')) return 'Supermercado';
    if (t.includes('uber') || t.includes('cabify') || t.includes('shell') || t.includes('ypf') || t.includes('axion') || t.includes('puma')) return 'Transporte';
    if (t.includes('netflix') || t.includes('spotify') || t.includes('steam') || t.includes('hbo') || t.includes('disney') || t.includes('apple') || t.includes('prime')) return 'Suscripciones';
    if (t.includes('mcdonalds') || t.includes('burger') || t.includes('rappi') || t.includes('pedidosya') || t.includes('starbucks') || t.includes('mostaza')) return 'Comida';
    if (t.includes('farmacia') || t.includes('hospital') || t.includes('osde') || t.includes('swiss') || t.includes('galeno')) return 'Salud';
    if (t.includes('merpago') || t.includes('mercado pago') || t.includes('meli')) return 'MercadoPago/Compras';
    if (t.includes('impuesto') || t.includes('sellos') || t.includes('iva') || t.includes('perc')) return 'Impuestos';
    
    return 'Varios'; 
}

//nueva ruta para enseñarle a la app
app.post('/api/aprender', async (req, res) => {
    console.log(`🧠 Intentando aprender: '${req.body.palabraClave}' -> '${req.body.categoria}'`);
    try {
        const { palabraClave, categoria } = req.body;
        const palabraLimpia = palabraClave.toLowerCase().trim();

        if (!palabraLimpia || !categoria) {
            return res.status(400).json({ mensaje: 'Faltan datos para aprender' });
        }

        let regla = await Regla.findOne({ where: { palabraClave: palabraLimpia } });
        if (regla) {
            regla.categoria = categoria;
            await regla.save();
        } else {
            await Regla.create({ palabraClave: palabraLimpia, categoria: categoria });
        }
        
        // actualiza la memoria
        await actualizarCerebro();
        
        // busca gastos viejos y corrige 
        const gastosViejos = await Gasto.findAll();
        let actualizados = 0;

        for (let g of gastosViejos) {
            if (g.descripcion.toLowerCase().includes(palabraLimpia) && g.categoria !== categoria) {
                g.categoria = categoria;
                await g.save();
                actualizados++;
            }
        }
        
        console.log(`✅ Aprendizaje exitoso. ${actualizados} gastos corregidos.`);
        res.json({ mensaje: `¡Aprendido! '${palabraClave}' ahora es '${categoria}'. Se corrigieron ${actualizados} gastos del pasado.` });
    } catch (error) {
        console.error("❌ Error grave al aprender:", error);
        res.status(500).json({ mensaje: 'Error interno al aprender.' });
    }
});
// logica de procesamiento
async function procesarPDF(path) {
    console.log(`📄 Leyendo PDF...`);
    const dataBuffer = fs.readFileSync(path);
    try {
        const data = await Promise.race([
            pdf(dataBuffer),
            new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 5000))
        ]);
        
        console.log("✅ ¡Texto extraído!");
        if (!data || !data.text) return [];

        // limpio formatos raros del banco para evitar que se cuelgue la pagina
        const textoLimpio = data.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lineas = textoLimpio.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        console.log(`📊 Analizando ${lineas.length} renglones...`);
        
        const resultados = [];
        // busca numeros seguidos de coma y dos dígitos
        const regexMonto = /\d+,\d{2}/; 
        const regexMeses = /Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic/i;

        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i];
            
            // si la linea tiene plata y no es un resumen de saldos
            if (regexMonto.test(linea) && !linea.toLowerCase().includes('saldo') && !linea.toLowerCase().includes('minimo')) {
                
                const coincidencia = linea.match(regexMonto)[0];
                const montoLimpio = coincidencia.replace(/\./g, '').replace(',', '.');
                const monto = parseFloat(montoLimpio);

                if (monto > 0) {
                    let desc = linea.replace(coincidencia, '').trim();
                    let fecha = "Sin Fecha";
                    
                    // suma la linea anterior para atrapar el nombre del local
                    if (i > 0) desc = lineas[i-1] + " " + desc;
                    
                    // atrapa el mes
                    const mesMatch = desc.match(regexMeses);
                    if (mesMatch) fecha = "Mes: " + mesMatch[0];

                    if (desc.length > 3 && !desc.toLowerCase().includes('su pago')) {
                        resultados.push({
                            fecha: fecha,
                            descripcion: desc.substring(0, 45).trim(),
                            monto: monto,
                            categoria: categorizar(desc),
                            tarjeta: 'Banco Macro'
                        });
                    }
                }
            }
        }
        
        console.log(`✅ Listo. Detectó ${resultados.length} gastos.`);
        return resultados;

    } catch (error) {
        console.error("❌ Error analizando PDF:", error.message);
        return [];
    }
}
// rutas de subida
app.post('/subir-resumen', upload.single('archivo'), async (req, res) => {
    console.log("📥 Petición recibida: POST /subir-resumen");
    try {
        if (!req.file) return res.status(400).json({ mensaje: 'Falta archivo' });
        
        await actualizarCerebro();
        const ext = req.file.originalname.toLowerCase();
        let resultados = [];

        if (ext.endsWith('.pdf')) {
            // logica para PDF
            resultados = await procesarPDF(req.file.path);
            
            if (resultados.length > 0) {
                console.log("💾 Guardando en base de datos...");
                try {
                    await Gasto.bulkCreate(resultados);
                    console.log("✅ ¡Base de datos actualizada!");
                } catch (err) {
                    console.error("❌ Error de la BD:", err.message);
                }
            }
            
            try { fs.unlinkSync(req.file.path); } catch(e){} 
            console.log("🚀 Respondiendo a la página web...");
            return res.json({ mensaje: `✅ ¡Éxito! Se procesaron ${resultados.length} gastos del PDF.` });

        } else if (ext.endsWith('.csv')) {
            // logica para CSV
            fs.createReadStream(req.file.path).pipe(csv()).on('data', (data) => {
                const valores = Object.values(data);
                const desc = data.Descripcion || valores[1] || 'Gasto';
                let montoStr = (data.Importe || valores[2] || '0').toString().replace('$', '').replace(/\./g, '').replace(',', '.').trim();
                const monto = parseFloat(montoStr);
                
                if (!isNaN(monto) && monto !== 0) {
                    resultados.push({ fecha: data.Fecha || valores[0], descripcion: desc, monto: Math.abs(monto), categoria: categorizar(desc), tarjeta: 'CSV' });
                }
            }).on('end', async () => {
                try {
                    await Gasto.bulkCreate(resultados);
                    console.log("✅ ¡Base de datos CSV actualizada!");
                } catch (err) {
                    console.error("❌ Error de la BD CSV:", err.message);
                }
                try { fs.unlinkSync(req.file.path); } catch(e){}
                return res.json({ mensaje: `✅ CSV: Se encontraron ${resultados.length} movimientos.` });
            });
        } else {
            // si suben otro formato
            try { fs.unlinkSync(req.file.path); } catch(e){}
            return res.status(400).json({ mensaje: 'Formato no soportado.' });
        }
    } catch (error) {
        console.error("❌ Error general en la subida:", error.message);
        if (!res.headersSent) return res.status(500).json({ mensaje: 'Error: ' + error.message });
    }
});

app.get('/api/gastos', async (req, res) => {
    const gastos = await Gasto.findAll({ order: [['id', 'DESC']] });
    res.json(gastos);
});

async function iniciarServidor() {
    try {
        console.log("Iniciando base de datos...");
        await iniciarDB(); 
        
        console.log("Cargando memoria del cerebro...");
        await actualizarCerebro(); 
        
        // solo se abre el puerto si todo lo de arriba funcionó
        app.listen(3000, () => {
            console.log('✅ Servidor Inteligente listo en: http://localhost:3000');
        });
    } catch (error) {
        console.error("❌ Error grave al iniciar el servidor:", error);
    }
}

app.post('/api/gastos', async (req,res)=>{
    try{
        const { fecha, descripcion, monto, categoria}= req.body;

        if(!descripcion || !monto){
            return res.status(400).json ({mensaje:'Faltan datos obligatorios'})
        }

        //crear el gasto directamente en la base de datos
        await Gasto.create({
            fecha: fecha || 'Sin fecha',
            descripcion: descripcion,
            monto: parseFloat(monto),
            categoria: categoria || 'Varios',
            tarjeta: 'Efectivo'
        });

        console.log("✅ Gasto manual guardado con éxito.");
        res.json({mensaje: "✅ ¡Gasto en efectivo agregado!"});
    } catch(error){
        console.error("❌ Error al guardar gasto manual:", error)
        res.status(500).json({mensaje:"Error interno al guardar"});
    }
})

iniciarServidor();