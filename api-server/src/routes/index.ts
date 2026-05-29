import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(chatRouter);

export default router;
