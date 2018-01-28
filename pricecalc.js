var rp = require('request-promise');
var bodyParser = require('body-parser')
var express = require('express');
var app = express();

//function gets orderbook data from the GDAX API and returns it via a promise
function getOrderBookData (product_id, level){
  return new Promise(function(resolve, reject) {
    var baseurl = `https://api.gdax.com/products/${product_id}/book?level=${level}`;
    var options = {
        uri: baseurl,
        headers: {
          'User-Agent': 'Coinbase-Challenge'
        },
        json: true // Automatically parses the JSON string in the response
    };
    rp(options).then(function (data) {
          return resolve(data);
      }).catch(function (err) {
          return reject(err);
      });
  });
}


//function cleans the data recieved from the GDAX API along with parameters requested by user to make it easier to calculate from the data
function processData (data, intent, requestedBase, requestedQuote, actualBase, actualQuote){
  return new Promise(function(resolve, reject) {
    var intentData;
    var reversePair = (requestedQuote = actualBase) && (requestedBase == actualQuote);
    if(intent == "buy"){
      intentData = data.asks;
      if(reversePair){
        intentData = data.bids;
      }
    }
    else if (intent == "sell"){
      intentData = data.bids;
      if(reversePair){
        intentData = data.asks;
      }
    }
    else {
      return reject("Invalid Option");
    }

    if(reversePair){
      for (var item in intentData){
        var price = intentData[item][0];
        intentData[item][0] = 1/intentData[item][0];
        intentData[item][1] = price*intentData[item][1];
      }
    }

    return resolve(intentData);

  });
}

//uses cleaned data to get best price available for User by calculating weighted average from avaaible orders until order is filled
function getBestPrice(data, unitsNeeded){
  return new Promise(function(resolve, reject) {
    var priceToPay = 0;
    var state = true;
    var orderFulfillPercent = 0;

    for (var item in data){

      var order = data[item];
      var price = order[0];
      var unitsAvailable = order[1];
      var numOfOrders = order[2];

      if(unitsAvailable >= unitsNeeded && state){
        priceToPay = price;
        return resolve(priceToPay);
      }
      else{
        fillPercent = (unitsAvailable/unitsNeeded);

        if(fillPercent+orderFulfillPercent >=1){
          priceToPay += price*(1-(orderFulfillPercent));
          return resolve(priceToPay);
        }

        orderFulfillPercent += fillPercent;
        priceToPay += (unitsAvailable/unitsNeeded)*price;
        state = false;
      }
    }

    return reject("Could not fill order");
  });
}

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.listen(3000);


app.post('/quote', function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  var getDataLevel = 2;

  var intent = req.body.action;
  var unitsNeeded = parseInt(req.body.amount);
  var base_currency = req.body.base_currency;
  var quote_currency = req.body.quote_currency;

  var product = base_currency+"-"+quote_currency;
  var reverseProduct = quote_currency+"-"+base_currency;

  //first tries getting orderbook of given pair and calculates value, if it fails try with inverse pair, and if it fails again, pair doesnt exist
  getOrderBookData(product, getDataLevel).then(function(data){
    processData(data, intent, quote_currency, base_currency, quote_currency, base_currency).then(function(data){
      getBestPrice(data, unitsNeeded).then((data)=> {
        res.send(JSON.stringify({price: data.toString(), total: (data*unitsNeeded).toString() ,currency: quote_currency}));
      }).catch((e) => {res.send({message: "Could not fill order!"})});
    }).catch((e) => {res.send({message: "Error Processing returned data, please make sure data is in correct format and try again!"})});
  }).catch((e) => {
    if(e.statusCode == 404){ //if given pair is not found, find the inverse of the pair, and if it exists, use that orderbook to calculate price and total
      getOrderBookData(reverseProduct, getDataLevel).then(function(data){
        processData(data, intent, quote_currency, base_currency, base_currency, quote_currency).then(function(data){
          getBestPrice(data, unitsNeeded).then((data)=> {
            res.send(JSON.stringify({price: data.toString(), total: (data*unitsNeeded).toString() ,currency:quote_currency}));
          }).catch((e) => {res.send({message: "Could not fill order!"})});
        }).catch((e) => {res.send({message: "Error Processing returned data, please make sure data is in correct format and try again!"})});
      }).catch((e) => {res.send({message: "Error Obtaining Order Book Data for given pair, please check input and try again!"})});
    }
    else{
      res.send({message: "Error Obtaining Order Book Data for given pair, please check input and try again!"});
    }
  })
});
