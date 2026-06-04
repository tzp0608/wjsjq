import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { AuthGuard } from '@nestjs/passport';
import { SubmissionsService } from './submissions.service';
import * as fs from 'fs';

@Controller('api/submissions')
export class SubmissionsController {
  constructor(private submissions: SubmissionsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  createSubmission(@Req() req: any, @Body() dto: any) {
    return this.submissions.createSubmission(req.user.userId, dto);
  }

  @Post(':submissionId/upload')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const tempDir = process.env.TEMP_FILE_DIR || '/tmp/pan-receiver';
        fs.mkdirSync(tempDir, { recursive: true });
        cb(null, tempDir);
      },
      filename: (req, file, cb) => {
        const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        cb(null, `${unique}_${file.originalname}`);
      },
    }),
  }))
  uploadFile(
    @Req() req: any,
    @Param('submissionId') submissionId: string,
    @Query('fileId') fileId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.submissions.uploadFile(submissionId, req.user.userId, file, fileId);
  }

  @Post(':submissionId/pan-files')
  @UseGuards(AuthGuard('jwt'))
  submitPanFiles(
    @Req() req: any,
    @Param('submissionId') submissionId: string,
    @Body('selectedFiles') selectedFiles: any[],
  ) {
    return this.submissions.submitPanFiles(req.user.userId, submissionId, selectedFiles);
  }

  @Get(':submissionId/status')
  @UseGuards(AuthGuard('jwt'))
  getStatus(@Param('submissionId') submissionId: string) {
    return this.submissions.getStatus(submissionId);
  }

  @Post(':submissionId/retry')
  @UseGuards(AuthGuard('jwt'))
  retry(@Req() req: any, @Param('submissionId') submissionId: string) {
    return this.submissions.retrySubmission(submissionId, req.user.userId);
  }

  @Post(':submissionId/transfer')
  @UseGuards(AuthGuard('jwt'))
  transferSubmission(@Req() req: any, @Param('submissionId') submissionId: string) {
    return this.submissions.transferSubmission(submissionId, req.user.userId);
  }
}
