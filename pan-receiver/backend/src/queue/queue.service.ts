import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

export interface UploadJobData {
  submissionId: string;
  fileId: string;
  localPath: string;
  submitterUserId: string;
  taskId: string;
}

export interface ShareJobData {
  submissionId: string;
  submitterUserId: string;
  taskId: string;
}

export interface TransferJobData {
  fileId: string;
  ownerUserId: string;
  targetPath: string;
}

export interface IQueueService {
  addUploadJob(data: UploadJobData): Promise<any>;
  addShareJob(data: ShareJobData): Promise<any>;
  addTransferJob(data: TransferJobData): Promise<any>;
}

@Injectable()
export class QueueService implements IQueueService {
  constructor(
    @InjectQueue('upload') private uploadQueue: Queue,
    @InjectQueue('share') private shareQueue: Queue,
    @InjectQueue('transfer') private transferQueue: Queue,
  ) {}

  async addUploadJob(data: UploadJobData) {
    return this.uploadQueue.add('upload-to-baidu-pan', data, {
      jobId: `upload_${data.fileId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
    });
  }

  async addShareJob(data: ShareJobData) {
    return this.shareQueue.add('create-share', data, {
      jobId: `share_${data.submissionId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
    });
  }

  async addTransferJob(data: TransferJobData) {
    return this.transferQueue.add('transfer-to-owner-pan', data, {
      jobId: `transfer_${data.fileId}`,
      attempts: 3,
      backoff: { type: 'fixed', delay: 300000 },
    });
  }
}
