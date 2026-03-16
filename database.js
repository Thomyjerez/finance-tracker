const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize('finance_tracker', 'root', 'Tho0mas120', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

//tabla de: tus gastos
const Gasto = sequelize.define('Gasto', {
    fecha: { type: DataTypes.STRING, allowNull: false },
    descripcion: { type: DataTypes.STRING, allowNull: false },
    monto: { type: DataTypes.FLOAT, allowNull: false },
    categoria: { type: DataTypes.STRING, defaultValue: 'Varios' },
    tarjeta: { type: DataTypes.STRING }
})

//tabla diccionario de aprendizaje
const Regla = sequelize.define ('Regla',{
    palabraClave:{
        type: DataTypes.STRING,
        allowNull:false,
        unique:true
    },
    categoria:{
        type:DataTypes.STRING,
        allowNull:false
    }
});

const iniciarDB = async ()=>{
    await sequelize.sync();
}

module.exports = {Gasto, Regla, iniciarDB};






























