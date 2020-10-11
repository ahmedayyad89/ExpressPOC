import UserModel from "../models/User";
import PasswordService from "../services/PasswordService";
import ClientError from "../exeptions/ClientError";
import TryCatchErrorDecorator from "../decorators/TryCatchErrorDecorator";
import TokenService from "../services/TokenService";
import AppError from "../exeptions/AppError";
import MailService from "../services/MailService";
import randomize from "../utils/randomize";
import config from "../config/app";
import RecaptchaService from '../services/RecaptchaService';


class AuthController {
  @TryCatchErrorDecorator
  static async signin(req, res) {
    const user = await UserModel.findOne({ email: req.body.email });
    if (!user) {
      throw new ClientError("User not found", 404);
    } else if (!user.email_verified) {
      throw new ClientError("Email not verified", 401);
    }

    if (RecaptchaService.checkRecaptcha(req.body.token)) {
      const checkPassword = await PasswordService.checkPassword(
        req.body.password,
        user.password
      );

      if (!checkPassword) {
        throw new ClientError("Incorrect email or password", 401);
      }

      const accessToken = await TokenService.createAccessToken(user);
      const refreshTokenHash = await TokenService.createRefreshToken(user);
      const refreshToken = await TokenService.addRefreshTokenUser(
        user,
        refreshTokenHash
      );

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          type: user.type
        }
      });
    } else {
      throw new ClientError("Recaptcha checking error", 401);
    }
  }

  @TryCatchErrorDecorator
  static async signup(req, res) {
    const isAlreadyUser = await UserModel.findOne({ email: req.body.email });
    if (isAlreadyUser) {
      throw new ClientError("This email is already registered", 409);
    }
    if (RecaptchaService.checkRecaptcha(req.body.token)) {
      const password = randomize.generateString(12);

      const user = new UserModel({
        name: req.body.name,
        email: req.body.email,
        type: req.body.type,
        password: await PasswordService.hashPassword(password),
        email_verified: false
      });

      await user.save();

      const token = await TokenService.createSetPasswordToken(user);

      MailService.sendWithTemplate(
        {
          to: req.body.email,
          subject: "Thanks for registering"
        },
        {
          template: "singup",
          data: {
            link: `${config.frontendHost}/setpassword/${user._id.toString()}/${token}`
          }
        }
      );

      res.json({ status: "success" });
    } else {
      throw new ClientError("Recaptcha checking error", 401);
    }
  }

  @TryCatchErrorDecorator
  static async setPassword(req, res) {
    const user = await UserModel.findOne({ _id: req.body.id });
    if (!user) {
      throw new ClientError("Token is invalid", 401);
    }

    const verifyData = await TokenService.verifyRestorePasswordToken(
      req.body.token,
      user.password,
    );

    if (!verifyData) {
      throw new ClientError("Token has expired or is invalid", 401);
    }

    const passwordHash = await PasswordService.hashPassword(req.body.password);
    user.password = passwordHash;
    user.email_verified = true;

    await user.save();

    res.json({ status: "success" });
  }

  @TryCatchErrorDecorator
  static async renewPasswordToken(req, res) {
    const user = await UserModel.findOne({ _id: req.body.id });
    if (!user) {
      throw new ClientError("Invalid token", 401);
    }

    const verifyData = await TokenService.verifyRestorePasswordToken(
      req.body.token,
      user.password,
    );

    if (verifyData) {
      throw new ClientError("Your token is still valid", 406);
    }

    const token = await TokenService.createSetPasswordToken(user);

    MailService.sendWithTemplate(
      {
        to: user.email,
        subject: "Your New Token"
      },
      {
        template: "singup",
        data: {
          link: `${config.frontendHost}/setpassword/${user._id}/${token}`
        }
      }
    );
    res.json({ status: "success" });
  }

  @TryCatchErrorDecorator
  static async checkPasswordTokenValidity(req, res) {
    const user = await UserModel.findOne({ _id: req.body.id });
    if (!user) {
      throw new ClientError("Invalid Token", 404);
    }
    else if (user.email_verified) {
      throw new ClientError("You have already set your password", 406);
    }

    const verifyData = await TokenService.verifyRestorePasswordToken(
      req.body.token,
      user.password,
    );

    if (!verifyData) {
      throw new ClientError("Token has expired", 401);
    }

    res.json({ status: "success" });
  }


  @TryCatchErrorDecorator
  static async refreshTokens(req, res) {
    const refreshTokenRequest = req.body.refreshToken;

    const verifyData = await TokenService.verifyRefreshToken(
      refreshTokenRequest
    );

    if (!verifyData) {
      throw new ClientError("Refresh token invalid or expired", 400);
    }

    const user = await UserModel.findOne({ _id: verifyData.id });

    const isValid = await TokenService.checkRefreshTokenUser(
      user,
      refreshTokenRequest
    );

    if (!isValid) {
      throw new ClientError("Refresh token invalid or expired", 400);
    }

    await TokenService.removeRefreshTokenUser(user, refreshTokenRequest);

    const accessToken = await TokenService.createAccessToken(user);
    const refreshTokenHash = await TokenService.createRefreshToken(user);
    const refreshToken = await TokenService.addRefreshTokenUser(
      user,
      refreshTokenHash
    );

    res.json({ accessToken, refreshToken });
  }

  @TryCatchErrorDecorator
  static async logout(req, res, next) {
    const user = await UserModel.findOne({ _id: req.userId });
    if (!user) {
      throw new AppError("UserId not found in request", 401);
    }

    user.refreshTokens = [];
    await user.save();

    res.json({ status: "success" });
  }

  @TryCatchErrorDecorator
  static async restorePassword(req, res, next) {
    const user = await UserModel.findOne({ email: req.body.email });

    if (!user) {
      throw new ClientError("User not found", 404);
    }

    const token = await TokenService.createRestorePasswordToken(user);

    MailService.sendWithTemplate(
      {
        to: user.email,
        subject: "Restore password"
      },
      {
        template: "restorePassword",
        data: {
          host: config.frontendHost,
          id: user._id.toString(),
          token
        }
      }
    );

    res.json({ status: "success" });
  }

  @TryCatchErrorDecorator
  static async confirmRestorePassword(req, res, next) {
    const tokenRequest = req.body.token;
    const id = req.body.id;
    const user = await UserModel.findOne({ _id: id });

    if (!user) {
      throw new ClientError("Refresh token invalid or expired", 400);
    }

    const verifyData = await TokenService.verifyRestorePasswordToken(
      tokenRequest,
      user.password,
    );

    if (!verifyData) {
      throw new ClientError("Refresh token invalid or expired", 400);
    }

    // const user = await UserModel.findOne({ _id: verifyData.id });
    const password = req.body.password;

    user.password = await PasswordService.hashPassword(password);
    await user.save();

    res.json({ status: "success" });
  }

  @TryCatchErrorDecorator
  static async verifyRestorePasswordToken(req, res, next) {
    const tokenRequest = req.body.token;
    const id = req.body.id;
    const user = await UserModel.findOne({ _id: id });

    if (!user) {
      throw new ClientError("Refresh token invalid or expired", 400);
    }

    const verifyData = await TokenService.verifyRestorePasswordToken(
      tokenRequest,
      user.password
    );

    if (!verifyData) {
      throw new ClientError("Refresh token invalid or expired", 400);
    }

    res.json({ status: "success" });
  }
}


export default AuthController;
