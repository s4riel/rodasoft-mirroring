import { Module } from '@nestjs/common';
import { EquivalencesController } from './equivalences.controller';
import { EquivalencesService } from './equivalences.service';
import { ProductCommandsService } from './product-commands.service';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StockMovementService } from './stock-movement.service';
import { StockQueriesService } from './stock-queries.service';
import { StorageService } from '../../common/storage/storage.service';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [ProductsController, ProductImportController, EquivalencesController, UploadsController],
  providers: [ProductsService, ProductCommandsService, ProductImportService, EquivalencesService, StockQueriesService, StockMovementService, StorageService],
})
export class InventoryModule {}
