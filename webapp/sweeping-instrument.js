// Max points in the chart and statisticstimeData
const MAX_VALUES = 500;
const MAX_VALUES_FRQ = 5;
const REC_ONE_SHOT_TIME = 5;

var frqData = [0];
var weightData = [0];
var timeData = [0];
var waitOneShot = false;
var pauseButtonStatus = -1;
var rcvData = false;
var firstAnalyticsDone = false;


// Color style for chart dataset
const CHART_COLORS = {
  red: 'rgb(255, 99, 132)',
  orange: 'rgb(255, 159, 64)',
  yellow: 'rgb(255, 205, 86)',
  green: 'rgb(75, 192, 192)',
  blue: 'rgb(54, 162, 235)',
  purple: 'rgb(153, 102, 255)',
  grey: 'rgb(201, 203, 207)'
};
const CHART_COLORS_ALPHA = {
  red: 'rgba(255, 99, 132, 0.7)',
  orange: 'rgba(255, 159, 64, 0.5)',
  yellow: 'rgba(255, 205, 86, 0.5)',
  green: 'rgba(75, 192, 192, 0.5)',
  blue: 'rgba(54, 162, 235, 0.7)',
  purple: 'rgba(153, 102, 255, 0.5)',
  grey: 'rgba(201, 203, 207, 0.5)'
};

// position in message from broom
const POS_WEIGHT_1 = 0;
const POS_WEIGHT_2 = 1;
const POS_ACC = 2;
const POS_ANGLE = 3;
const POS_FRQ = 4;

// live graph position
const GRAPH_WEIGHT_1 = 0;
const GRAPH_WEIGHT_2 = 1;
const GRAPH_ACC = 2;
const GRAPH_ANGLE = 3;

// report graph position
const REPORT_WEIGHT_1 = 0;
const REPORT_WEIGHT_2 = 1;
const REPORT_ACC = 0;
const REPORT_ANGLE = 0;


// UUID definition, must the same as the settings in the BLE device. https://www.uuidgenerator.net/
const SERVICE_UUID = "13d3440c-b82d-42f7-a2b9-d4ea1f4635f0";
const CHARACTERISTIC_UUID = "fb460b35-0884-4f2a-aa38-22c1ce5d8918";

// Class for the Web Bluetooth interface, connect and activate the notify to receive data from the instrument
class SweepingInstrumentBLE {

  constructor() {
    this.device = null;
    this.onDisconnected = this.onDisconnected.bind(this);
  }
  
  // filter the available devices
  async request() {
    let options = {
      "filters": [{
        "name": "sweeping"  //BLE name
      }],
      "optionalServices": [SERVICE_UUID]
    };
    this.device = await navigator.bluetooth.requestDevice(options);
    if (!this.device) {
      throw "No device selected";
    }
    this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
  }
  
  async connect() {
    if (!this.device) {
      return Promise.reject('Device is not connected.');
    }
    await this.device.gatt.connect();
    console.log('Device connected');
    BLEconnectedStyle();
    rcvData = true;

    reset();
  }
  
  async readReportingValue() {
    const service = await this.device.gatt.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    await characteristic.readValue();
  }

  async startReportingValueNotifications(listener) {
    const service = await this.device.gatt.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', valueChanged);
  }

  async stopReportingValueNotifications(listener) {
    const service = await this.device.gatt.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    await characteristic.stopNotifications();
    characteristic.removeEventListener('characteristicvaluechanged', valueChanged);
  }

  disconnect() {
    if (!this.device) {
      return Promise.reject('Device is not connected.');
    }
    BLEdisconnectedStyle();
    return this.device.gatt.disconnect();
  }

  onDisconnected() {
    console.log('Device is disconnected.');
  }

}
  
// Start connection to BLE device, it's needed for security reasons
document.getElementById("btn-connect").addEventListener('click', async event => {
  try {
    await sweepingInstrumentBLE.request();
    await sweepingInstrumentBLE.connect();
    await sweepingInstrumentBLE.startReportingValueNotifications();
  } catch(error) {
    console.log(error);
  }
});

var sweepingInstrumentBLE = new SweepingInstrumentBLE();
var decoder = new TextDecoder("utf-8");

function ab2str(buf) {
    return decoder.decode(new Uint8Array(buf));
}

var debug;
// new data from BLE device with notify
function valueChanged(event) {
  
  // check if the pause button is active
  if (rcvData) {
    let rcvTime = Date.now();

    // convert the received string value to a float
    let utf8decoder = new TextDecoder();
    var buf = utf8decoder.decode(event.target.value);
    var newValues = JSON.parse(buf);
    debug = newValues;
    
    // if the received value is minor than 0 convert it to 0
    if ( newValues.w1 < 0 ) newValues.w1 = 0;
    if ( newValues.w2 < 0 ) newValues.w2 = 0;

    // how big is the dataset with the measurements
    let length = myChart.data.datasets[GRAPH_WEIGHT_1].data.length;

    // if the dataset is bigger than MAX_VALUES remove the first item of the array
    if ( length > MAX_VALUES ) {
      myChart.data.datasets[GRAPH_WEIGHT_1].data.shift();
      myChart.data.datasets[GRAPH_WEIGHT_2].data.shift();
      myChart.data.datasets[GRAPH_ACC].data.shift();
      myChart.data.datasets[GRAPH_ANGLE].data.shift();

      weightData.shift();
      timeData.shift();
    }

    // add the new value at the end of the array
    myChart.data.datasets[GRAPH_WEIGHT_1].data.push(+(newValues.w1));  
    myChart.data.datasets[GRAPH_WEIGHT_2].data.push(+(newValues.w2));
    myChart.data.datasets[GRAPH_ACC].data.push(+(calculateIceAcceleration(newValues.acc.Y,newValues.acc.Z,newValues.a)));   
    myChart.data.datasets[GRAPH_ANGLE].data.push(+(newValues.a));

    weightData.push(+(newValues.w1) + +(newValues.w2));
    timeData.push(rcvTime);

    // update the chart with the new values
    myChart.update();

    // update the statistics values
    updateStat ( newValues.w1 );   // TODO aggiungere anche il peso della cella nr 2

    if (waitOneShot && (weightData[weightData.length-1]>2)) {
      waitOneShot = false;

      // Set timer
      window.setTimeout( recOneShotStop, REC_ONE_SHOT_TIME * 1000);

      // Reset all values
      reset();

      // Disable pause button
      pauseButtonStyle(0);
      document.getElementById("btn-recshot").classList.remove("btn-warning");
      document.getElementById("btn-recshot").classList.add("btn-danger");
    }

  }
}

function calculateIceAcceleration(accX, accY, broomAngle) {     // for the LSM6DSL accX= Y axes and accY= Z axes
  var vModule= math.sqrt(math.square(accX)+math.square(accY));
  var vAngle= math.asin(accY / vModule);

  var newAngle= (broomAngle * (math.pi/180)) - vAngle;

  var iceAcceleration= vModule * math.cos(newAngle);
 
  return iceAcceleration;
}


// Chart generate an array from 0 to MAX_VALUES for the x axe
const labelID = Array.from(Array(MAX_VALUES).keys());

// Chart data 0: data from instrument, 1: movement, 2: calculated mean
const data = {
  labels: labelID,
  datasets: [
    {
      label: 'Weight cell 1',
      backgroundColor: CHART_COLORS.red,
      borderColor: CHART_COLORS_ALPHA.red,
      data: [0],
      pointRadius: 0,
      spanGaps: true,
      // type: 'area',
      normalized: true,
      fill: true,
    },
    {
      label: 'Weight cell 2',
      backgroundColor: CHART_COLORS.orange,
      borderColor: CHART_COLORS_ALPHA.orange,
      data: [0],
      pointRadius: 0,
      spanGaps: true,
      // type: 'area',
      normalized: true,
      fill: true,
    },
    {
      label: 'Acceleration',
      backgroundColor: CHART_COLORS.green,
      borderColor: CHART_COLORS_ALPHA.green,
      data: [0],
      pointRadius: 0,
      spanGaps: true,
      yAxisID: 'y1'
    },
    {
      label: 'Angle',
      backgroundColor: CHART_COLORS.blue,
      borderColor: CHART_COLORS_ALPHA.blue,
      data: [0],
      pointRadius: 0,
      spanGaps: true,
      yAxisID: 'y2',
      hidden: true
    }
  ]
};

// Chart settings
const config = {
    data: data,
    type: 'line',
    options: {
      scales: {
        x: {
          type: 'linear',
          display: false,
          min: 0,
          max: MAX_VALUES,
          ticks: {
            source: 'auto',
            // Disabled rotation for performance
            maxRotation: 0,
            autoSkip: true,
          }
        },
        y: {
          stacked: true,
          min: 0,
          suggestedMin: 0,
          suggestedMax: 5,
        },

        // Y axe for acceleration
        y1: {
          display: false,
          suggestedMin: -1,
          suggestedMax: 1,
        },

        // Y axe for angle
        y2: {
          display: false,
          suggestedMin: 0,
          suggestedMax: 90,
        },
      },
      plugins: {
        legend: {
            display: true
            
        },
        tooltip: {
          enabled: false
        }
      },
      animation: false
    }
};

// connect the canvas element with JS
const myChart = new Chart(
    document.getElementById('myChart'),
    config
);

// Change the style of pause button 
function pauseButtonStyle (style) {
  if (style == 0) {
    // Style for normal operation (data running)
    document.getElementById("btn-pause").classList.add("btn-primary");
    document.getElementById("btn-pause").classList.remove("btn-danger");
    document.getElementById("btn-pause").classList.remove("disabled");
    document.getElementById("btn-pause").classList.remove("btn-secondary");

    // Style save and analyse button
    document.getElementById("btn-analyse").classList.add("disabled");
    document.getElementById("btn-save").classList.add("disabled");

    // Style the analyse section
    document.getElementById("report-section").classList.add("visually-hidden");

    pauseButtonStatus = 0;
  }
  else if (style >= 1) {
    // Style pause active (no data)
    document.getElementById("btn-pause").classList.remove("btn-primary");
    document.getElementById("btn-pause").classList.add("btn-danger");
    document.getElementById("btn-pause").classList.remove("disabled");
    document.getElementById("btn-pause").classList.remove("btn-secondary");

    // Style save and analyse button
    document.getElementById("btn-analyse").classList.remove("disabled");
    document.getElementById("btn-save").classList.remove("disabled");

    pauseButtonStatus = 1;
  }
  else {
    // Button disabled (no connection to broom)
    document.getElementById("btn-pause").classList.remove("btn-primary");
    document.getElementById("btn-pause").classList.remove("btn-danger");
    document.getElementById("btn-pause").classList.add("disabled");
    document.getElementById("btn-pause").classList.add("btn-secondary");

    pauseButtonStatus = -1;
  }
}


// Pause button click
function pause() {
  if (pauseButtonStatus == 0) {
    pauseButtonStyle(1);
    rcvData = false;
  }
  else {
    pauseButtonStyle(0);
    rcvData = true;
  }
}

// Reset all values
function reset (){
  // Reset chart data
  myChart.data.datasets[GRAPH_WEIGHT_1].data = [0];
  myChart.data.datasets[GRAPH_WEIGHT_2].data = [0];

  // Reset chart data
  myChart.data.datasets[GRAPH_ACC].data = [0];
  myChart.data.datasets[GRAPH_ANGLE].data = [0];
  myChart.update();

  // Reset local data
  weightData = [0];
  frqData = [0];
  timeData = [0];

  // Reset statistics values
  document.getElementById("last-value").innerHTML = 0;
  document.getElementById("max-value").innerHTML = 0;
  document.getElementById("mean-value").innerHTML = 0;
  document.getElementById("freq-value").innerHTML = 0;

  pauseButtonStyle(0);
  rcvData = true;
}

// Start the recording with auto stop
function recOneShot () {
  waitOneShot = true;
  rcvData = true;

  pauseButtonStyle(-1);
  document.getElementById("btn-recshot").classList.add("btn-warning");
  document.getElementById("btn-recshot").classList.remove("btn-primary");
}

// Stop the recording
function recOneShotStop () {
  rcvData = false;
  pauseButtonStyle(1);

  document.getElementById("btn-recshot").classList.add("btn-primary");
  document.getElementById("btn-recshot").classList.remove("btn-danger");
  document.getElementById("btn-recshot").classList.remove("btn-warning");
}

// Change the page style if the BLE device is connected
function BLEconnectedStyle () {
  document.getElementById("statistic-section").classList.remove("visually-hidden");
  // Button Pause
  pauseButtonStyle(0);

  // Button Reset
  document.getElementById("btn-reset").classList.remove("disabled");
  document.getElementById("btn-reset").classList.remove("btn-secondary");
  document.getElementById("btn-reset").classList.add("btn-primary");

  // Button Rec on shot
  document.getElementById("btn-recshot").classList.remove("disabled");
  document.getElementById("btn-recshot").classList.remove("btn-secondary");
  document.getElementById("btn-recshot").classList.add("btn-primary");

  // Button Save
  document.getElementById("btn-save").classList.remove("btn-secondary");
  document.getElementById("btn-save").classList.add("btn-primary");

  // Button Analyse
  document.getElementById("btn-analyse").classList.remove("btn-secondary");
  document.getElementById("btn-analyse").classList.add("btn-primary");

  // Button Connect
  document.getElementById("btn-connect").classList.remove("btn-primary");
  document.getElementById("btn-connect").classList.add("btn-secondary");
  document.getElementById("btn-connect").innerHTML = "BLE scan";
}

// Change the page style if the BLE device is disconnected
function BLEdisconnectedStyle() {
  document.getElementById("statistic-section").classList.add("visually-hidden");
  pauseButtonStyle(-1);
  // document.getElementById("btn-reset").classList.add("disabled");
  document.getElementById("btn-connect").classList.add("btn-primary");
  document.getElementById("btn-connect").classList.remove("btn-secondary");
  document.getElementById("btn-connect").innerHTML = "Connect BLE";
}

// Update all statistics values
function updateStat( weight ) {

  // update the last value field
  document.getElementById("last-value").innerHTML = weightData[weightData.length-1].toFixed(1);

  // search the max value in the dataset
  document.getElementById("max-value").innerHTML = math.max(weightData).toFixed(1);

  // for the other statistics we need at least to values
  if (weightData.length > 2) {

    // calculate the mean value
    var meanValue = math.mean(weightData);
    document.getElementById("mean-value").innerHTML = meanValue.toFixed(1);
  }

  document.getElementById("angle-value").innerHTML = myChart.data.datasets[GRAPH_ANGLE].data[myChart.data.datasets[GRAPH_ANGLE].data.length-1].toFixed(0);
}

// generate a pdf from the actual page
function save() {
  var element = document.getElementById('page');
  var opt = {
    filename:     'sweeping-results.pdf',
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'cm', format: 'a4', orientation: 'landscape' }
  };

  html2pdf().set(opt).from(element).save();
}

var reportWeight = [{ data: []},{ data: []}];
  var reportAcc = [{ data: []}];
  var reportAngle = [{ data: []}];
// Generate the analysis for the current data
function analyse() {
  

  document.getElementById("report-section").classList.remove("visually-hidden");
  
  if (firstAnalyticsDone) {
    weightChart.resetSeries();
    accChart.resetSeries();
    angleChart.resetSeries();
  }
  
  weightChart.render();
  accChart.render();
  angleChart.render();

  let length = timeData.length;

  for (i=0; i<length; i++) {
    if (timeData[i] != 0) {
      let tempWeight1 = [];
      tempWeight1[0] = timeData[i];
      tempWeight1[1] = myChart.data.datasets[GRAPH_WEIGHT_1].data[i];
      reportWeight[REPORT_WEIGHT_1].data.push(tempWeight1);

      let tempWeight2 = [];
      tempWeight2[0] = timeData[i];
      tempWeight2[1] = myChart.data.datasets[GRAPH_WEIGHT_2].data[i];
      reportWeight[REPORT_WEIGHT_2].data.push(tempWeight2);

      let tempAcc = [];
      tempAcc[0] = timeData[i];
      tempAcc[1] = myChart.data.datasets[GRAPH_ACC].data[i];
      reportAcc[REPORT_ACC].data.push(tempAcc);

      let tempAngle = [];
      tempAngle[0] = timeData[i];
      tempAngle[1] = myChart.data.datasets[GRAPH_ANGLE].data[i];
      reportAngle[REPORT_ANGLE].data.push(tempAngle);
    }
  }

  weightChart.updateSeries(reportWeight);
  accChart.updateSeries(reportAcc);
  angleChart.updateSeries(reportAngle);

  firstAnalyticsDone = true;

  let powerScore1 = 0;
  let powerScore2 = 0;
  let powerScore = 0;
  let powerForward = 0;

  for (i=1;i<reportWeight[REPORT_WEIGHT_1].data.length; i++) {
    powerScore1= powerScore1 + ((reportWeight[REPORT_WEIGHT_1].data[i][1]) * ((reportWeight[REPORT_WEIGHT_1].data[i][0] - reportWeight[REPORT_WEIGHT_1].data[i-1][0]) / 1000));
    powerScore2= powerScore2 + ((reportWeight[REPORT_WEIGHT_2].data[i][1]) * ((reportWeight[REPORT_WEIGHT_2].data[i][0] - reportWeight[REPORT_WEIGHT_2].data[i-1][0]) / 1000));

    if (reportAcc[REPORT_ACC].data[i][1] >0) {
      powerForward = powerForward + ((reportAcc[REPORT_ACC].data[i][1]) * ((reportAcc[REPORT_ACC].data[i][0] - reportAcc[REPORT_ACC].data[i-1][0]) / 1000));
    }
  }
  powerScore= powerScore1 + powerScore2;
  document.getElementById("powerScore-value").innerHTML = powerScore.toFixed(1);

  
  let weightGaugePercent = 0;
  weightGaugePercent = (powerScore1 / (powerScore1 + powerScore2)) *100;
  weightGaugeOptions.series = [weightGaugePercent.toFixed(0)];

  var weightGauge = new ApexCharts(document.querySelector("#weightGauge"), weightGaugeOptions);
  weightGauge.render();

  let forwardGaugePercent = 0;
  forwardGaugePercent = (powerForward / powerScore) *100;

  forwardGaugeOptions.series = [forwardGaugePercent.toFixed(0)];
  var forwardGauge = new ApexCharts(document.querySelector("#forwardGauge"), forwardGaugeOptions);
  forwardGauge.render();
}
// var reportWeight = TESTreportWeight;
// var reportAcc = TESTreportAcc;
// function analyse() {

//   document.getElementById("report-section").classList.remove("visually-hidden");
  
//   if (firstAnalyticsDone) {
//     weightChart.resetSeries();
//     accChart.resetSeries();
//   }
  
//   weightChart.render();
//   accChart.render();

//   weightChart.updateSeries(reportWeight);
//   accChart.updateSeries(reportAcc);

//   firstAnalyticsDone = true;

//   // ##################################
//   let powerScore1 = 0;
//   let powerScore2 = 0;
//   let powerScore = 0;
//   let powerForward = 0;

//   for (i=1;i<reportWeight[REPORT_WEIGHT_1].data.length; i++) {
//     powerScore1= powerScore1 + ((reportWeight[REPORT_WEIGHT_1].data[i][1]) * ((reportWeight[REPORT_WEIGHT_1].data[i][0] - reportWeight[REPORT_WEIGHT_1].data[i-1][0]) / 1000));
//     powerScore2= powerScore2 + ((reportWeight[REPORT_WEIGHT_2].data[i][1]) * ((reportWeight[REPORT_WEIGHT_2].data[i][0] - reportWeight[REPORT_WEIGHT_2].data[i-1][0]) / 1000));

//     if (reportAcc[REPORT_ACC].data[i][1] >0) {
//       powerForward = powerForward + ((reportAcc[REPORT_ACC].data[i][1]) * ((reportAcc[REPORT_ACC].data[i][0] - reportAcc[REPORT_ACC].data[i-1][0]) / 1000));
//     }
//   }
//   powerScore= powerScore1 + powerScore2;
//   document.getElementById("powerScore-value").innerHTML = powerScore.toFixed(1);

  
//   let weightGaugePercent = 0;
//   weightGaugePercent = (powerScore1 / (powerScore1 + powerScore2)) *100;
//   weightGaugeOptions.series = [weightGaugePercent.toFixed(0)];

//   var weightGauge = new ApexCharts(document.querySelector("#weightGauge"), weightGaugeOptions);
//   weightGauge.render();

//   let forwardGaugePercent = 0;
//   forwardGaugePercent = (powerForward / powerScore) *100;

//   forwardGaugeOptions.series = [forwardGaugePercent.toFixed(0)];
//   var forwardGauge = new ApexCharts(document.querySelector("#forwardGauge"), forwardGaugeOptions);
//   forwardGauge.render();
// }

// Chart settings
var weightChartOptions = {
  chart: {
    height: 380,
    width: "100%",
    type: "area",
    id: 'weight',
    group: 'broomData',
    animations: {
      initialAnimation: {
        enabled: false
      }
    },
    stacked: true,
    toolbar: {
      show: true,
      offsetX: 0,
      offsetY: 0,
      tools: {
        download: true,
        selection: false,
        zoom: true,
        zoomin: true,
        zoomout: true,
        pan: false,
        reset: true | '<img src="/static/icons/reset.png" width="20">',
        customIcons: []
      },
      export: {
        csv: {
          filename: 'SmartBroom',
          columnDelimiter: ',',
          headerCategory: 'category',
          headerValue: 'value',
          dateFormatter(timestamp) {
            return new Date(timestamp).toDateString()
          }
        },
        svg: {
          filename: 'SmartBroom',
        },
        png: {
          filename: 'SmartBroom',
        }
      },
      autoSelected: 'zoom' 
    },
  },
  series: [
    {
      name: "Weight cell 1",
      data: []
    },
    {
      name: "Weight cell 2",
      data: []
    }
  ],
  fill: {
    type: "gradient",
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.7,
      opacityTo: 0.9,
      stops: [0, 90, 100]
    }
  },
  xaxis: {
    type: 'datetime'
  },
  yaxis: {
    decimalsInFloat: 0
  },
  dataLabels: {
    enabled: false
  },
  stroke: {
    curve: 'smooth'
  },
  title: {
    text: 'Weight report',
    align: 'left'
  },
  markers: {
    size: 0
  }
};




var accChartOptions = {
  chart: {
    height: 380,
    width: "100%",
    type: "line",
    id: 'acc',
    group: 'broomData',
    animations: {
      initialAnimation: {
        enabled: false
      }
    },
    stacked: true,
    toolbar: {
      show: true,
      offsetX: 0,
      offsetY: 0,
      tools: {
        download: true,
        selection: false,
        zoom: true,
        zoomin: true,
        zoomout: true,
        pan: false,
        reset: true | '<img src="/static/icons/reset.png" width="20">',
        customIcons: []
      },
      export: {
        csv: {
          filename: 'SmartBroom',
          columnDelimiter: ',',
          headerCategory: 'category',
          headerValue: 'value',
          dateFormatter(timestamp) {
            return new Date(timestamp).toDateString()
          }
        },
        svg: {
          filename: 'SmartBroom',
        },
        png: {
          filename: 'SmartBroom',
        }
      },
      autoSelected: 'zoom' 
    },
  },
  series: [
    {
      name: "Acceleration",
      data: []
    },
  ],
  xaxis: {
    type: 'datetime'
  },
  yaxis: [
    {
      seriesName: 'Acceleration',
      decimalsInFloat: 2,
      min: -2,
      max: 2,
      forceNiceScale: true,
      title: {
        text: "Accelerometer",
        rotate: -90,
      },
    },
  ],
  theme: {
    monochrome: {
      enabled: true,
      color: '#255aee',
      shadeTo: 'light',
      shadeIntensity: 0.65
    }
  },
  dataLabels: {
    enabled: false
  },
  stroke: {
    curve: 'smooth'
  },
  title: {
    text: 'Acceleration reporting',
    align: 'left'
  },
  markers: {
    size: 0
  }
};


var angleChartOptions = {
  chart: {
    height: 380,
    width: "100%",
    type: "line",
    id: 'acc',
    group: 'broomData',
    animations: {
      initialAnimation: {
        enabled: false
      }
    },
    stacked: true,
    toolbar: {
      show: true,
      offsetX: 0,
      offsetY: 0,
      tools: {
        download: true,
        selection: false,
        zoom: true,
        zoomin: true,
        zoomout: true,
        pan: false,
        reset: true | '<img src="/static/icons/reset.png" width="20">',
        customIcons: []
      },
      export: {
        csv: {
          filename: 'SmartBroom',
          columnDelimiter: ',',
          headerCategory: 'category',
          headerValue: 'value',
          dateFormatter(timestamp) {
            return new Date(timestamp).toDateString()
          }
        },
        svg: {
          filename: 'SmartBroom',
        },
        png: {
          filename: 'SmartBroom',
        }
      },
      autoSelected: 'zoom' 
    },
  },
  series: [
    {
      name: "Angle",
      data: []
    },
  ],
  xaxis: {
    type: 'datetime'
  },
  yaxis: [
    {
      seriesName: 'Angle',
      decimalsInFloat: 0,
      min: 0,
      max: 90,
      forceNiceScale: true,
      title: {
        text: "Angle",
        rotate: -90,
      },
    },
  ],
  theme: {
    monochrome: {
      enabled: true,
      color: '#255aee',
      shadeTo: 'light',
      shadeIntensity: 0.65
    }
  },
  dataLabels: {
    enabled: false
  },
  stroke: {
    curve: 'smooth'
  },
  title: {
    text: 'Angle reporting',
    align: 'left'
  },
  markers: {
    size: 0
  }
};

var weightGaugeOptions = {
  series: [0],
  chart: {
  type: 'radialBar',
  offsetY: -20,
  sparkline: {
    enabled: true
    }
  },
  plotOptions: {
    radialBar: {
      startAngle: -90,
      endAngle: 90,
      track: {
        background: "#e7e7e7",
        strokeWidth: '97%',
        margin: 5, // margin is in pixels
        dropShadow: {
          enabled: true,
          top: 2,
          left: 0,
          color: '#999',
          opacity: 1,
          blur: 2
        }
      },
      dataLabels: {
        name: {
          show: false
        },
        value: {
          offsetY: -2,
          fontSize: '22px'
        }
      }
    }
  },
  grid: {
    padding: {
      top: -10
    }
  },
  fill: {
    type: 'gradient',
    gradient: {
      shade: 'light',
      shadeIntensity: 0.4,
      inverseColors: false,
      opacityFrom: 1,
      opacityTo: 1,
      stops: [0, 50, 53, 91]
    },
  },
  labels: ['Average Results'],
};


var forwardGaugeOptions = {
  series: [0],
  chart: {
  type: 'radialBar',
  offsetY: -20,
  sparkline: {
    enabled: true
    }
  },
  plotOptions: {
    radialBar: {
      startAngle: -90,
      endAngle: 90,
      track: {
        background: "#e7e7e7",
        strokeWidth: '97%',
        margin: 5, // margin is in pixels
        dropShadow: {
          enabled: true,
          top: 2,
          left: 0,
          color: '#999',
          opacity: 1,
          blur: 2
        }
      },
      dataLabels: {
        name: {
          show: false
        },
        value: {
          offsetY: -2,
          fontSize: '22px'
        }
      }
    }
  },
  grid: {
    padding: {
      top: -10
    }
  },
  fill: {
    type: 'gradient',
    gradient: {
      shade: 'light',
      shadeIntensity: 0.4,
      inverseColors: false,
      opacityFrom: 1,
      opacityTo: 1,
      stops: [0, 50, 53, 91]
    },
  },
  labels: ['Average Results'],
};

var weightChart = new ApexCharts(document.querySelector("#weightChart"), weightChartOptions);
var accChart = new ApexCharts(document.querySelector("#accChart"), accChartOptions);
var angleChart = new ApexCharts(document.querySelector("#angleChart"), angleChartOptions);
