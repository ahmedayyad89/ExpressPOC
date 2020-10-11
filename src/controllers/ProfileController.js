import config from '../config/aws';
import S3 from 'aws-sdk/clients/s3';
import { v4 as uuidv4 } from 'uuid';
import { extension } from 'mime-types';
import ProfileModel from '../models/Profile'
import UserModel from '../models/User'
import TryCatchErrorDecorator from "../decorators/TryCatchErrorDecorator";
import ClientError from '../exeptions/ClientError';
import PasswordService from '../services/PasswordService';


class UploadController {


    @TryCatchErrorDecorator
    static async saveProfile(req, res) {
        const s3 = new S3({
            accessKeyId: config.awsAccessKey,
            secretAccessKey: config.awsSecretKey
        });
        const profileModel = {
            nothingFilePath: [],
            assignmentFilePath: [],
            otherFilePath: [],
            anotherFilePath: [],
            passportFilePath: [],
            drivingLicenseFilePath: [],
        }

        if (req.files)
            for (const key of Object.keys(req.files)) {
                if (Array.isArray(req.files[key])) {
                    for (let index = 0; index < req.files[key].length; index++) {
                        console.log('file' + req.files[key][index]);

                        const location = await sendFiletoAWS(s3, req.files[key][index], req.userId);
                        profileModel[key + 'Path'].push(location);
                    }
                } else {
                    const location = await sendFiletoAWS(s3, req.files[key], req.userId);
                    profileModel[key + 'Path'].push(location);
                }
            }
        profileModel.firstName = req.body.firstName;
        profileModel.lastName = req.body.lastName;
        profileModel.address = req.body.address;
        profileModel.country = req.body.country;
        profileModel.city = req.body.city;
        profileModel.phone = req.body.phone;
        profileModel.gender = req.body.gender;
        profileModel.type = req.body.type;
        profileModel.state = req.body.state;
        profileModel.userId = req.userId;


        const profile = new ProfileModel(profileModel);
        await profile.save();

        res.json({ status: "success" });
    }

    @TryCatchErrorDecorator
    static async findHistory(req, res) {
        const profileHistory = await ProfileModel.find({ userId: req.userId }).sort({ createdAt: -1 });
        res.json(profileHistory);
    }


    @TryCatchErrorDecorator
    static async download(req, res) {
        const s3 = new S3({
            accessKeyId: config.awsAccessKey,
            secretAccessKey: config.awsSecretKey
        });
        console.log(req.query.location)
        const url = req.query.location;
        let urlArray = url.split("/");
        let key = `${urlArray[3]}/${urlArray[4]}`;

        const params = {
            Bucket: config.s3BucketName,
            Key: key
        };
        const object = await s3.getObject(params).promise();
        res.send(object.Body);
    }

    @TryCatchErrorDecorator
    static async changePassword(req, res) {
        const id = req.userId;
        const user = await UserModel.findOne({ _id: id });

        if (!user) {
            throw new ClientError("User invalid or expired", 400);
        }

        // const user = await UserModel.findOne({ _id: verifyData.id });
        const password = req.body.oldPassword;
        const checkPassword = await PasswordService.checkPassword(
            password,
            user.password
        );

        if (!checkPassword) {
            throw new ClientError("Wrong old Password", 401);
        }

        user.password = await PasswordService.hashPassword(req.body.newPassword);
        await user.save();

        res.json({ status: "success" });
    }

}
const sendFiletoAWS = async (s3, file, userId) => {
    const params = {
        Bucket: config.s3BucketName,
        Key: userId + '/' + uuidv4() + '.' + extension(file.mimetype), // File name you want to save as in S3
        Body: file.data
    };
    const path = await s3.upload(params).promise();
    return path.Location;
}
export default UploadController;
