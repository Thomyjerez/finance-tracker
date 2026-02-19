const express = require('express');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const pdf = require('pdf-parse'); 
const { Gasto, iniciarDB } = require('./database');

const app = express();
const upload = multer({ dest: 'uploads/' }); 

app.use(express.static('public')); 
app.use(express.json());

// categorizador
function categorizar(texto) {
    if (!texto) return 'Varios';
    const t = texto.toLowerCase();
    
    if (t.includes('super') || t.includes('coto') || t.includes('carrefour') || t.includes('dia') || t.includes('jumbo') || t.includes('vea')) return 'Supermercado';
    if (t.includes('uber') || t.includes('cabify') || t.includes('shell') || t.includes('ypf') || t.includes('axion') || t.includes('puma')) return 'Transporte';
    if (t.includes('netflix') || t.includes('spotify') || t.includes('steam') || t.includes('hbo') || t.includes('disney') || t.includes('apple') || t.includes('prime')) return 'Suscripciones';
    if (t.includes('mcdonalds') || t.includes('burger') || t.includes('rappi') || t.includes('pedidosya') || t.includes('starbucks') || t.includes('mostaza')) return 'Comida';
    if (t.includes('farmacia') || t.includes('hospital') || t.includes('osde') || t.includes('swiss') || t.includes('galeno')) return 'Salud';
    if (t.includes('merpago') || t.includes('mercado pago') || t.includes('meli')) return 'MercadoPago/Compras';
    if (t.includes('impuesto') || t.includes('sellos') || t.includes('iva') || t.includes('perc')) return 'Impuestos';
    
    return 'Varios'; 
}

// logica especial para ejemplode visa macro
async function procesarPDF(path) {
    console.log(`📂 Leyendo PDF: ${path}`);
    const dataBuffer = fs.readFileSync(path);

    try {
        const data = await pdf(dataBuffer);
        const texto = data.text;
        
        const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const resultados = [];
        
        const regexFecha = /^(\d{2}\.\d{2}\.\d{2})$/;
        
        const regexMonto = /[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}/; 

        for (let i = 0; i < lineas.length; i++) {
            const lineaActual = lineas[i];

            if (regexFecha.test(lineaActual)) {
                
                const fecha = lineaActual;
                let descripcion = "";
                let monto = null;
                let lineasSaltadas = 0;

                for (let j = 1; j <= 5; j++) {
                    const indiceFuturo = i + j;
                    if (indiceFuturo >= lineas.length) break; 

                    const lineaFutura = lineas[indiceFuturo];
                        //es dinero ? logica
                    if (regexMonto.test(lineaFutura)) {
                        const montoLimpio = lineaFutura.match(regexMonto)[0]
                                            .replace(/\./g, '') 
                                            .replace(',', '.'); 
                        
                        monto = parseFloat(montoLimpio);
                        lineasSaltadas = j; 
                        break; 
                    } else {
                        // si no es plata y no es otra fecha, es parte de la DESCRIPCIÓN
                        if (!regexFecha.test(lineaFutura) && isNaN(lineaFutura)) {
                            descripcion += lineaFutura + " ";
                        }
                    }
                }

                // guardar monto y fecha si la encuentra
                if (monto !== null && !isNaN(monto)) {
                    resultados.push({
                        fecha: fecha,
                        descripcion: descripcion.trim() || "Consumo Visa",
                        monto: monto,
                        categoria: categorizar(descripcion),
                        tarjeta: 'Visa Macro'
                    });
                    
                    i += lineasSaltadas; 
                }
            }
        }

        return resultados;

    } catch (error) {
        console.error("❌ Error leyendo PDF:", error);
        return [];
    }
}

// routes
app.post('/subir-resumen', upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ mensaje: 'Falta archivo' });

        const ext = req.file.originalname.toLowerCase();
        let resultados = [];

        if (ext.endsWith('.pdf')) {
            resultados = await procesarPDF(req.file.path);
            
            if (resultados.length > 0) {
                await Gasto.bulkCreate(resultados);
                fs.unlinkSync(req.file.path);
                res.json({ mensaje: `✅ ¡Éxito! Se detectaron ${resultados.length} gastos en el PDF.` });
            } else {
                fs.unlinkSync(req.file.path);
                res.json({ mensaje: '⚠️ Leí el PDF pero no encontré el patrón de gastos. Revisa la consola.' });
            }

        } else if (ext.endsWith('.csv')) {
            // logica CSV 
            fs.createReadStream(req.file.path)
                .pipe(csv())
                .on('data', (data) => {
                    const valores = Object.values(data);
                    const descripcion = data.Descripcion || data.Concepto || valores[1] || 'Gasto';
                    let montoStr = data.Importe || data.Monto || valores[2] || '0';
                    montoStr = montoStr.toString().replace('$', '').replace(/\./g, '').replace(',', '.').trim();
                    const monto = parseFloat(montoStr);
                    
                    if (!isNaN(monto) && monto !== 0) {
                        resultados.push({
                            fecha: data.Fecha || valores[0],
                            descripcion,
                            monto: Math.abs(monto),
                            categoria: categorizar(descripcion),
                            tarjeta: 'CSV'
                        });
                    }
                })
                .on('end', async () => {
                    await Gasto.bulkCreate(resultados);
                    fs.unlinkSync(req.file.path);
                    res.json({ mensaje: `CSV: Se encontraron ${resultados.length} movimientos.` });
                });
        } else {
            res.status(400).json({ mensaje: 'Solo se aceptan .csv o .pdf' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error interno: ' + error.message });
    }
});

app.get('/api/gastos', async (req, res) => {
    const gastos = await Gasto.findAll({ order: [['id', 'DESC']] });
    res.json(gastos);
});

app.listen(3000, async () => {
    await iniciarDB();
    console.log('✅ Servidor listo en: http://localhost:3000');
});