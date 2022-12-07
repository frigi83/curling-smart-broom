/**
  Name: Smart curling broom V2
  Purpose: Measure all vital parameter during the sweeping action in curling

  @author M. Frigerio
  @version 2.0 24/09/22

*/

// Library and settings for the HX711 weight cells
#include <HX711_ADC.h>

#define HX711_DOUT_CELL_1 27          // mcu > HX711 CELL 1 dout pin
#define HX711_SCK_CELL_1  5           // mcu > HX711 CELL 1 sck pin
#define HX711_DOUT_CELL_2 23          // mcu > HX711 CELL 2 dout pin
#define HX711_SCK_CELL_2  19          // mcu > HX711 CELL 2 sck pin
#define CALIBRATION_VALUE_1 7071.39   // Calibration value for cell 1, from calibration software
#define CALIBRATION_VALUE_2 7157.47   // Calibration value for cell 2, from calibration software
#define STABILIZING_TIME 4000         // tare preciscion can be improved by adding a few seconds of stabilizing time (in ms)
#define TARE true                    // set this to false if you don't want tare to be performed

HX711_ADC LoadCell_1(HX711_DOUT_CELL_1, HX711_SCK_CELL_1); // HX711 CELL 1
HX711_ADC LoadCell_2(HX711_DOUT_CELL_2, HX711_SCK_CELL_2); // HX711 CELL 2

struct WeightData{
  float cell1;
  float cell2;
};

// Library and settings for the ADXL345 accelerometer
#define ACCELEROMETER_MODEL 3         // 1: ADXL345, 2: MPU6050, 3:LSM6DSL

struct IMUdata{
  double accX;
  double accY;
  double accZ;
  double gyroX;
  double gyroY;
  double gyroZ;
};

#if ACCELEROMETER_MODEL==1          // ADXL345
  #include <Wire.h>
  #include<ADXL345_WE.h>
  #define ADXL345_I2CADDR 0x53
  ADXL345_WE myAcc = ADXL345_WE(ADXL345_I2CADDR);

#elif ACCELEROMETER_MODEL==2        //MPU6050

#else                                 //LSM6DSL
  #define I2C_SDA 21
  #define I2C_SCL 22
  #include <Adafruit_LSM6DSL.h>
  Adafruit_LSM6DSL lsm6ds; 
  Adafruit_Sensor *lsm_temp, *lsm_accel, *lsm_gyro;
#endif

// Library and settings for the data buffer
#include <CircularBuffer.h>

CircularBuffer<double,SAMPLES> sensorData;

// Library and settings for the Bluetooth Low Energy (BLE)
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
#define SERVICE_UUID        "13d3440c-b82d-42f7-a2b9-d4ea1f4635f0"
#define CHARACTERISTIC_UUID "fb460b35-0884-4f2a-aa38-22c1ce5d8918"

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
    }
};

// Library and settings for the Fast Fourier Transform (FFT)
#include <arduinoFFT.h>
#define SAMPLING_FREQUENCY 80
#define SAMPLES 128                   //This value MUST ALWAYS be a power of 2


#define LED_STATUS 2     //LED for the start/error status
static boolean newDataReady = false;

#include <ArduinoJson.h>
#include <MadgwickAHRS.h>
Madgwick filter;

void setup() {
  Serial.begin(115200); delay(10);
  Serial.println();
  Serial.println("Starting...");

  // pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED_STATUS, OUTPUT);
  digitalWrite(LED_STATUS, LOW);

  // blink one time the status LED
  ledBlink(1);

  // initialize BLE, weight cells and IMU
  initializeBLE();
  initializeWeightCells();
  initializeIMU();
  filter.begin(30);
  
  Serial.println("Startup is complete");
  ledBlink(3);
}


void loop() {

  if (deviceConnected) {

    // check for new data/start next conversion
    if (LoadCell_1.update()) newDataReady = true;
      LoadCell_2.update();

    //there is new data?
    if ((newDataReady)) {
      readValue();
      newDataReady = false;
      delay(20); // bluetooth stack will go into congestion, if too many packets are sent, in 6 hours test i was able to go as low as 3ms
    }
  }

  // disconnecting
  if (!deviceConnected && oldDeviceConnected) {
      delay(500); // give the bluetooth stack the chance to get things ready
      pServer->startAdvertising(); // restart advertising
      Serial.println("start advertising");
      oldDeviceConnected = deviceConnected;
  }
  // connecting
  if (deviceConnected && !oldDeviceConnected) {
      oldDeviceConnected = deviceConnected;
  }

}


/**
  Initialize the BLE

  @param void
  @return void
*/
void initializeBLE(void) {

  // Create the BLE Device
  BLEDevice::init("sweeping");

  // Create the BLE Server
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Create the BLE Service
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Create a BLE Characteristic
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  
  // Create a BLE Descriptor
  pCharacteristic->addDescriptor(new BLE2902());

  // Start the service
  pService->start();

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x0);  // set value to 0x00 to not advertise this parameter
  BLEDevice::startAdvertising();

}

/**
  Initialize the weight cells

  @param void
  @return void
*/
void initializeWeightCells(void) {

  LoadCell_1.begin();
  LoadCell_2.begin();

  byte loadcell_1_rdy = 0;
  byte loadcell_2_rdy = 0;

  //run startup, stabilization and tare, both modules
  while ((loadcell_1_rdy + loadcell_2_rdy) < 2) {
    if (!loadcell_1_rdy) loadcell_1_rdy = LoadCell_1.startMultiple(STABILIZING_TIME, TARE);
    if (!loadcell_2_rdy) loadcell_2_rdy = LoadCell_2.startMultiple(STABILIZING_TIME, TARE);
  }


  if (LoadCell_1.getTareTimeoutFlag()) {    // check if cell 1 is not working
    hardwareProblem("Timeout, check MCU>HX711 no.1 wiring and pin designations");
  }

  if (LoadCell_2.getTareTimeoutFlag()) {    // check if cell 2 is not working
    hardwareProblem("Timeout, check MCU>HX711 no.2 wiring and pin designations");
  }

  // calibrate the weight cells, calibration values are specific for every cell 
  LoadCell_1.setCalFactor(CALIBRATION_VALUE_1);
  LoadCell_2.setCalFactor(CALIBRATION_VALUE_2);

}


#if ACCELEROMETER_MODEL==1          // ADXL345
/**
  Initialize the accelerometer

  @param void
  @return void
*/
void initializeIMU(void) {

  Wire.begin();
  
  if (!myAcc.init()) {
    hardwareProblem("Failed to find ADXL345 chip");
  }

  Serial.println("ADXL345 Found!");

  myAcc.setDataRate(ADXL345_DATA_RATE_100);
  myAcc.setRange(ADXL345_RANGE_4G);
}


/**
  Read IMU values: accelerometer and gyroscope

  @param 
  @return void
*/
void readIMUValues(IMUdata *imuData) {
  xyzFloat values = myAcc.getGValues();
  double acc = values.x;
  
  if ((acc < 0.1)&&(acc > -0.1)) acc=0;

  imuData->acc=acc;
  imuData->gyro=0;
}

#elif ACCELEROMETER_MODEL==2        //MPU6050

#else                                 //LSM6DSL
/**
  Initialize the accelerometer

  @param void
  @return void
*/
void initializeIMU(void) {

  Wire.begin();
  
  if (!lsm6ds.begin_I2C()) {
    hardwareProblem("Failed to find LSM6DSL chip");
  }

  lsm6ds.setAccelRange(LSM6DS_ACCEL_RANGE_4_G);
  // lsm6ds.setGyroRange(LSM6DS_GYRO_RANGE_250_DPS);  
  // lsm6ds.setAccelDataRate(LSM6DS_RATE_104_HZ);
  // lsm6ds.setGyroDataRate(LSM6DS_RATE_104_HZ);
  // lsm6ds.highPassFilter(true, LSM6DS_HPF_ODR_DIV_100);

  Serial.println("LSM6DSL found!");
}


/**
  Read IMU values: accelerometer and gyroscope

  @param 
  @return void
*/
void readIMUValues(IMUdata *imuData) {
  float accX, accY, accZ;
  lsm6ds.readAcceleration(accX,accY,accZ);

  float gyroX, gyroY, gyroZ;
  lsm6ds.readGyroscope(gyroX,gyroY,gyroZ);

  imuData->accX=accX;
  imuData->accY=accY;
  imuData->accZ=accZ;
  imuData->gyroX=gyroX;
  imuData->gyroY=gyroY;
  imuData->gyroZ=gyroZ;
}
#endif


/**
  Activate error state print a mesage on the serial port and activate the status LED

  @param message error message to be sent on serial port
  @return no return infinity loop
*/
void hardwareProblem(String message) {

  Serial.print( "ERROR: " );
  Serial.println( message );
  ledBlink(-1);
  while(1) {
    delay(10000);
  }

}

/**
  Blink the status LED

  count < 0 => LED always on
  count > 0 => LED blink # count times

  @param count amount of blink times
  @return void
*/
void ledBlink(int count) {

  if (count < 0) {
    digitalWrite(LED_STATUS, HIGH);
    return;
  }
  
  if (count == 0) {
    return;
  }

  for (int i = 0; i < count; i++) {
    digitalWrite(LED_STATUS, HIGH);   
    delay(500);              
    digitalWrite(LED_STATUS, LOW);   
    delay(500);
  }

}

/**
  New weight value ready

  @param void
  @return bool new value ready
*/
bool newValueReady(void) {

}


/**
  Read weight form the two cells

  @param void
  @return void
*/
void readWeightValues(WeightData *weightData) {
  weightData->cell1 = LoadCell_1.getData();
  weightData->cell2 = LoadCell_2.getData();
}


/**
  Read all value (weight cells and accelerometer)

  @param void
  @return void
*/
void readValue(void) {
  WeightData weightData;
  IMUdata imuValues;
  float roll;

  readWeightValues(&weightData);
  readIMUValues(&imuValues);
  
  String sendText;
  DynamicJsonDocument newData(250);

  newData["w1"] = weightData.cell1;
  newData["w2"] = weightData.cell2;
  
  JsonObject acc = newData.createNestedObject("acc");
  acc["X"] = imuValues.accX;
  acc["Y"] = imuValues.accY;
  acc["Z"] = imuValues.accZ;

  JsonObject gyro = newData.createNestedObject("gyro");
  gyro["X"] = imuValues.gyroX;
  gyro["Y"] = imuValues.gyroY;
  gyro["Z"] = imuValues.gyroZ;

  filter.updateIMU(imuValues.gyroX, imuValues.gyroY, imuValues.gyroZ, imuValues.accX, imuValues.accY, imuValues.accZ);
  newData["a"] = filter.getRoll();
  

  serializeJson(newData, sendText);

  if (deviceConnected) {
    pCharacteristic->setValue(sendText.c_str());
    pCharacteristic->notify();
  }
  
  //Serial.print("=> ");
  Serial.println(sendText);

}

