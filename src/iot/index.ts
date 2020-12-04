import { io, iot, mqtt } from "aws-iot-device-sdk-v2";


export function alexaConfig() {
    return {
        certPath: process.env['CERT_PATH'],
        clientId: process.env['CLIENT_ID'],
        host: process.env['VESTIBULE_HOST'],
        mqttLogLevel: process.env['AWS_MQTT_LOG_LEVEL']
    }

}

export async function createConnection(): Promise<mqtt.MqttClientConnection> {
    const appConfig = alexaConfig()

    if (appConfig.mqttLogLevel) {
        const level: io.LogLevel = parseInt(io.LogLevel[appConfig.mqttLogLevel.toUpperCase()]);
        io.enable_logging(level);
    }

    const bootstrap = new io.ClientBootstrap()
    const client = new mqtt.MqttClient(bootstrap)
    const config = iot.AwsIotMqttConnectionConfigBuilder
        .new_mtls_builder_from_path(appConfig.certPath + '/vestibule.cert.pem', appConfig.certPath + '/vestibule.private.key')
        .with_certificate_authority_from_path(undefined, appConfig.certPath + '/AmazonRootCA1.pem')
        .with_client_id(appConfig.clientId)
        .with_clean_session(false)
        .with_endpoint(appConfig.host)
        .build()

    const connection = client.new_connection(config)

    //Timer is needed or else connect hangs and does not return
    const timer = setTimeout(() => { }, 60 * 1000);
    const connected = await connection.connect()
    clearTimeout(timer)

    if (!connected) {
        throw new Error("Connection failed")
    }

    return connection;
}