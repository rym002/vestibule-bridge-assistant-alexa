import { io, iot, mqtt } from "aws-iot-device-sdk-v2";


export function alexaConfig() {
    return {
        certPath: process.env['CERT_PATH'],
        clientId: process.env['CLIENT_ID'],
        host: process.env['VESTIBULE_HOST']
    }

}

export async function createConnection(): Promise<mqtt.MqttClientConnection> {
    const bootstrap = new io.ClientBootstrap()

    const client = new mqtt.MqttClient(bootstrap)
    const appConfig = alexaConfig()
    const config = iot.AwsIotMqttConnectionConfigBuilder
        .new_mtls_builder_from_path(appConfig.certPath + '/vestibule.cert.pem', appConfig.certPath + '/vestibule.private.key')
        .with_certificate_authority(appConfig.certPath + '/AmazonRootCA1.pem')
        .with_client_id(appConfig.clientId)
        .with_endpoint(appConfig.host)
        .build()

    const connection = client.new_connection(config)

    const connected = await connection.connect()

    if (!connected) {
        throw new Error("Connection failed")
    }

    return connection;
}